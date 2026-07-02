import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { resolveAccess, type SessionAccess } from "./access";
import { publishEvent } from "./bus";
import { isActiveTurnForToken, activeInitiativeName } from "./combat-turn";
import {
  TACTICAL_MAP_COLUMNS,
  TACTICAL_MAP_ROWS,
  freeMovementCostForTokenMove,
  movementCostForTokenMove,
  tokenMovement,
  type MovementToken,
} from "./movement";
import { movementGridForSession } from "./movement-grid";
import {
  activeCombatStateForSession,
  activeExplorationStateForSession,
  combatResourcesForTurn,
  movementSpentForTurn,
} from "./tactical-state";
import { withSessionMutation } from "./session-mutation";

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

      if (
        !isActiveTurnForToken({
          initiative: encounter.initiative,
          turnIndex: encounter.activeTurn,
          token,
        })
      ) {
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
        grid,
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
        },
        { actorId: access.userId },
      );

      return NextResponse.json({
        ok: true,
        mode: "combat",
        eventId: ev.id,
        movementRemaining: nextMovementRemaining,
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
