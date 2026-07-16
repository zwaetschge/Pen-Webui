import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { resolveAccess, type SessionAccess } from "./access";
import { publishEvent } from "./bus";
import { isActiveTurnForToken, activeInitiativeName } from "./combat-turn";
import {
  normalizeEncounterRuntime,
  completedTurnMembers,
  type EncounterRuntime,
} from "./encounter-runtime";
import {
  TACTICAL_MAP_COLUMNS,
  TACTICAL_MAP_ROWS,
  freeMovementCostForTokenMove,
  movementCostForTokenMove,
  tokenMovement,
  type MovementGrid,
  type MovementToken,
} from "./movement";
import { movementGridForSession } from "./movement-grid";
import {
  normalizeTacticalGrid,
  pointKey,
  surfaceEffectAt,
  surfaceAt,
  type SurfaceEffect,
  type TacticalGrid,
} from "./rules/tactical";
import {
  activeCombatStateForSession,
  activeExplorationStateForSession,
  combatResourcesForTurn,
  movementSpentForTurn,
} from "./tactical-state";
import { withSessionMutation } from "./session-mutation";
import {
  activeTurnGroup,
  tokenCanActInGroup,
} from "./turn-groups";

const bodySchema = z.object({
  tokenId: z.string().min(1).max(120),
  requestId: z.string().min(8).max(120).optional(),
  x: z
    .number()
    .int()
    .min(0)
    .max(TACTICAL_MAP_COLUMNS - 1),
  y: z
    .number()
    .int()
    .min(0)
    .max(TACTICAL_MAP_ROWS - 1),
});

type Access = NonNullable<SessionAccess>;

export async function handleMoveToken(
  req: Request,
  sessionId: string,
  inviteTokenOverride?: string | null,
) {
  const inviteToken =
    inviteTokenOverride !== undefined
      ? inviteTokenOverride
      : new URL(req.url).searchParams.get("token");
  const access = await resolveAccess({ sessionId, inviteToken });
  if (!access) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json(
      { error: "bad_request", issues: body.error.format() },
      { status: 400 },
    );
  }

  return withSessionMutation(sessionId, async () => {
    const duplicate = await existingMoveEvent(sessionId, body.data.requestId);
    if (duplicate) {
      const payload = recordPayload(duplicate.payload);
      return NextResponse.json({
        ok: true,
        duplicate: true,
        mode: String(payload.mode ?? "move"),
        eventId: duplicate.id,
      });
    }

    const session = await prisma.gameSession.findUnique({
      where: { id: sessionId },
      select: { campaignId: true, endedAt: true },
    });
    if (!session || session.endedAt) {
      return NextResponse.json({ error: "session_closed" }, { status: 410 });
    }

    const encounter = await prisma.encounter.findFirst({
      where: { campaignId: session.campaignId, status: "active" },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        initiative: true,
        activeTurn: true,
        round: true,
        locationId: true,
        runtime: true,
      },
    });
    if (encounter) {
      const combatState = await activeCombatStateForSession(sessionId);
      const tokens = combatState?.tokens ?? [];
      const token = tokens.find(
        (candidate) => candidate.id === body.data.tokenId,
      );
      if (!token) {
        return NextResponse.json({ error: "token_not_found" }, { status: 404 });
      }

      if (
        !(await canMoveToken({
          access,
          campaignId: session.campaignId,
          token,
        }))
      ) {
        return NextResponse.json({ error: "forbidden" }, { status: 403 });
      }

      const runtime = normalizeEncounterRuntime(encounter.runtime);
      const turnGroup = activeTurnGroup(
        encounter.initiative,
        encounter.activeTurn,
        tokens,
      );
      const groupStartIndex = turnGroup?.startIndex ?? encounter.activeTurn;
      const completedTokenIds = completedTurnMembers(
        runtime,
        encounter.round,
        groupStartIndex,
      );
      const mayActInTurn = turnGroup
        ? tokenCanActInGroup(token.id, turnGroup, completedTokenIds)
        : isActiveTurnForToken({
            initiative: encounter.initiative,
            turnIndex: encounter.activeTurn,
            token,
          });
      if (!mayActInTurn) {
        return NextResponse.json(
          {
            error: "not_your_turn",
            active: activeInitiativeName(
              encounter.initiative,
              encounter.activeTurn,
            ),
          },
          { status: 409 },
        );
      }

      const grid = await movementGridForSession({
        sessionId,
        campaignId: session.campaignId,
        locationId: encounter.locationId,
      });
      const tacticalGrid = tacticalGridForMovement(grid, runtime);
      const movement = tokenMovement(token);
      const resources = combatResourcesForTurn(
        combatState?.actionEvents ?? [],
        {
          tokenId: body.data.tokenId,
          round: encounter.round,
          turnIndex: encounter.activeTurn,
        },
      );
      const movementAllowance = movement + resources.movementBonus;
      const movementSpent = movementSpentForTurn(combatState?.moves ?? [], {
        tokenId: body.data.tokenId,
        round: encounter.round,
        turnIndex: encounter.activeTurn,
      });
      const movementRemaining = Math.max(0, movementAllowance - movementSpent);
      const tokensWithRemainingMovement = tokens.map((candidate) =>
        candidate.id === token.id
          ? { ...candidate, movement: movementRemaining }
          : candidate,
      );
      const movementCost = movementCostForTokenMove(
        body.data.tokenId,
        tokensWithRemainingMovement,
        { x: body.data.x, y: body.data.y },
        tacticalGrid,
      );
      if (movementCost === null) {
        return NextResponse.json(
          {
            error:
              movementRemaining <= 0 ? "movement_exhausted" : "illegal_move",
            movement: movementAllowance,
            movementSpent,
            movementRemaining,
          },
          { status: 422 },
        );
      }
      const nextMovementSpent = movementSpent + movementCost;
      const nextMovementRemaining = Math.max(
        0,
        movementAllowance - nextMovementSpent,
      );
      const destination = { x: body.data.x, y: body.data.y };
      const surface = surfaceAt(tacticalGrid, destination);
      const surfaceEffect = surfaceEffectAt(
        tacticalGrid,
        destination,
        "enter",
      );

      const ev = await publishEvent(
        sessionId,
        "token_moved",
        {
          mode: "combat",
          tokenId: body.data.tokenId,
          fromX: token.x,
          fromY: token.y,
          x: body.data.x,
          y: body.data.y,
          movementCost,
          movement: movementAllowance,
          baseMovement: movement,
          movementBonus: resources.movementBonus,
          movementSpent: nextMovementSpent,
          movementRemaining: nextMovementRemaining,
          movedBy: access.displayName,
          requestId: body.data.requestId,
          round: encounter.round,
          turnIndex: encounter.activeTurn,
          ...(surface
            ? {
                surface: {
                  type: surface.type,
                  intensity: surface.intensity,
                },
                surfaceEffect,
              }
            : {}),
        },
        { actorId: access.userId },
      );

      await publishSurfaceEntryEffects({
        sessionId,
        encounterId: encounter.id,
        runtime,
        token,
        surfaceType: surface?.type ?? null,
        effect: surfaceEffect,
        round: encounter.round,
        turnIndex: encounter.activeTurn,
        actorId: access.userId,
      });

      return NextResponse.json({
        ok: true,
        mode: "combat",
        eventId: ev.id,
        movementRemaining: nextMovementRemaining,
        ...(surface ? { surfaceEffect } : {}),
      });
    }

    const explorationState = await activeExplorationStateForSession(
      sessionId,
      session.campaignId,
    );
    const tokens = explorationState.tokens;
    const token = tokens.find(
      (candidate) => candidate.id === body.data.tokenId,
    );
    if (!token) {
      return NextResponse.json({ error: "token_not_found" }, { status: 404 });
    }

    if (
      !(await canMoveToken({
        access,
        campaignId: session.campaignId,
        token,
      }))
    ) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    const grid = await movementGridForSession({
      sessionId,
      campaignId: session.campaignId,
      locationId: null,
    });
    const movementCost = freeMovementCostForTokenMove(
      body.data.tokenId,
      tokens,
      { x: body.data.x, y: body.data.y },
      grid,
    );
    if (movementCost === null) {
      return NextResponse.json({ error: "illegal_move" }, { status: 422 });
    }

    const ev = await publishEvent(
      sessionId,
      "token_moved",
      {
        mode: "exploration",
        tokenId: body.data.tokenId,
        fromX: token.x,
        fromY: token.y,
        x: body.data.x,
        y: body.data.y,
        movementCost: null,
        movedBy: access.displayName,
        requestId: body.data.requestId,
      },
      { actorId: access.userId },
    );

    return NextResponse.json({
      ok: true,
      mode: "exploration",
      eventId: ev.id,
    });
  });
}

function tacticalGridForMovement(
  grid: MovementGrid,
  runtime: EncounterRuntime,
): TacticalGrid {
  const base = normalizeTacticalGrid(grid, {
    columns: grid.columns,
    rows: grid.rows,
  });
  const runtimeGrid = normalizeTacticalGrid(
    {
      columns: base.columns,
      rows: base.rows,
      surfaces: runtime.surfaces,
      objects: runtime.objects,
    },
    { columns: base.columns, rows: base.rows },
  );
  const surfaces = new Map(
    base.surfaces.map((surface) => [pointKey(surface), surface]),
  );
  runtimeGrid.surfaces.forEach((surface) =>
    surfaces.set(pointKey(surface), surface),
  );
  const objects = new Map(base.objects.map((object) => [object.id, object]));
  runtimeGrid.objects.forEach((object) => objects.set(object.id, object));
  return {
    ...base,
    surfaces: [...surfaces.values()],
    objects: [...objects.values()],
  };
}

async function publishSurfaceEntryEffects(input: {
  sessionId: string;
  encounterId: string;
  runtime: EncounterRuntime;
  token: MovementToken;
  surfaceType: string | null;
  effect: SurfaceEffect;
  round: number;
  turnIndex: number;
  actorId: string | null;
}) {
  if (!input.surfaceType) return;
  const eventOptions = { actorId: input.actorId };
  if (input.effect.damage > 0 && input.effect.damageType) {
    await publishEvent(
      input.sessionId,
      "damage_applied",
      {
        targetId: input.token.id,
        amount: input.effect.damage,
        type: input.effect.damageType,
        sourceTokenId: null,
        sourceName: `${input.surfaceType}-surface`,
        surfaceType: input.surfaceType,
        phase: "enter",
        round: input.round,
        turnIndex: input.turnIndex,
      },
      eventOptions,
    );
  }

  if (input.effect.conditions.length === 0) return;
  const existing = input.runtime.statuses[input.token.id] ?? [];
  const nextStatuses = [...existing];
  for (const condition of input.effect.conditions) {
    const normalized = condition.toLowerCase();
    const withoutCondition = nextStatuses.filter(
      (status) =>
        String(status.id ?? status.condition ?? "").toLowerCase() !== normalized,
    );
    nextStatuses.splice(
      0,
      nextStatuses.length,
      ...withoutCondition,
      {
        id: condition,
        condition,
        source: `surface:${input.surfaceType}`,
        appliedRound: input.round,
      },
    );
    await publishEvent(
      input.sessionId,
      "status_updated",
      {
        encounterId: input.encounterId,
        targetId: input.token.id,
        condition,
        active: true,
        source: `surface:${input.surfaceType}`,
        round: input.round,
        turnIndex: input.turnIndex,
      },
      eventOptions,
    );
  }
  await prisma.encounter.update({
    where: { id: input.encounterId },
    data: {
      runtime: {
        ...input.runtime,
        statuses: {
          ...input.runtime.statuses,
          [input.token.id]: nextStatuses,
        },
      } as never,
    },
  });
}

async function existingMoveEvent(
  sessionId: string,
  requestId: string | undefined,
) {
  if (!requestId) return null;
  return prisma.eventLog.findFirst({
    where: {
      sessionId,
      type: "token_moved",
      payload: { path: ["requestId"], equals: requestId },
    },
    orderBy: [{ ts: "desc" }, { id: "desc" }],
    select: { id: true, payload: true },
  });
}

function recordPayload(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

async function canMoveToken(input: {
  access: Access;
  campaignId: string;
  token: MovementToken;
}) {
  if (input.access.role === "player") {
    if (input.access.characterId === input.token.id) return true;
    if (!input.access.userId) return false;
    const character = await prisma.character.findFirst({
      where: {
        id: input.token.id,
        campaignId: input.campaignId,
        ownerId: input.access.userId,
      },
      select: { id: true },
    });
    return Boolean(character);
  }

  const character = await prisma.character.findFirst({
    where: { id: input.token.id, campaignId: input.campaignId },
    select: { id: true },
  });
  return Boolean(character);
}
