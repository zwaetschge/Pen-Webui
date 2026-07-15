"use client";

/**
 * PixiJS tactical map.
 *
 * Renders:
 *   - optional background image (location.tacticalMap)
 *   - a square grid overlay
 *   - tokens (player/npc/monster) at (x,y) cell coords
 *   - HP bars and team-coloured rings
 *
 * Interactions:
 *   - select your active character token to show its movement range
 *   - click a highlighted grid cell to move
 *
 * Pan/zoom for everyone:
 *   - middle-mouse drag = pan
 *   - wheel = zoom
 *
 * Tokens and scene backgrounds come from server events. Fog-of-war is still a
 * separate server-authoritative layer.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Assets,
  Application,
  Container,
  Graphics,
  Sprite,
  Text,
  Texture,
} from "pixi.js";
import type { FederatedPointerEvent } from "pixi.js";
import { useGame, type CombatState, type Token } from "@/lib/game/store";
import {
  TACTICAL_MAP_COLUMNS,
  TACTICAL_MAP_ROWS,
  blockedTilesForGrid,
  freeMovementTilesForToken,
  movementRangeForToken,
  tileKey,
  tokenMovement,
  type MovementTile,
} from "@/lib/game/movement";
import { isActiveTurnForToken } from "@/lib/game/combat-turn";

const CELL = 88;
const MAP_COLUMNS = TACTICAL_MAP_COLUMNS;
const MAP_ROWS = TACTICAL_MAP_ROWS;
const MAP_WIDTH = MAP_COLUMNS * CELL;
const MAP_HEIGHT = MAP_ROWS * CELL;
const GRID_COLOR = 0x6b5a30;
const GRID_ALPHA = 0.34;
const MOVE_FILL = 0x2f6ba8;
const MOVE_STROKE = 0x83b6df;
const SELECTED_FILL = 0xc39a4e;
const SELECTED_STROKE = 0xf0d58a;
const MIN_ZOOM = 0.35;
const MAX_ZOOM = 3;
const EMPTY_GRID = {};

type TokenContainer = Container & {
  assetUrl?: string | null;
  assetSeq?: number;
};

type Props = {
  sessionId: string;
  inviteToken?: string;
  role: "host" | "player";
  localCharacters?: Array<{ id: string; name: string }>;
  selectedTokenId?: string | null;
  onSelectedTokenChange?: (tokenId: string | null) => void;
  readOnly?: boolean;
};

export function TacticalMap(props: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const propsRef = useRef(props);
  const appRef = useRef<Application | null>(null);
  const tokenSpritesRef = useRef<Map<string, Container>>(new Map());
  const worldRef = useRef<Container | null>(null);
  const movementOverlayRef = useRef<Graphics | null>(null);
  const blockedOverlayRef = useRef<Graphics | null>(null);
  const backgroundRef = useRef<Sprite | null>(null);
  const backgroundSeqRef = useRef(0);
  const cameraTouchedRef = useRef(false);
  const [internalSelectedTokenId, setInternalSelectedTokenId] = useState<
    string | null
  >(null);
  const [pixiReadyVersion, setPixiReadyVersion] = useState(0);
  const movementRef = useRef<{
    selectedTokenId: string | null;
    destinations: Map<string, MovementTile>;
  }>({ selectedTokenId: null, destinations: new Map() });

  // pull tokens reactively
  const tokens = useGame((s) => s.tokens);
  const scene = useGame((s) => s.scene);
  const combat = useGame((s) => s.combat);
  const controlledSelectedTokenId = props.selectedTokenId;
  const onSelectedTokenChange = props.onSelectedTokenChange;
  const selectedTokenId =
    controlledSelectedTokenId !== undefined
      ? controlledSelectedTokenId
      : internalSelectedTokenId;
  const updateSelectedTokenId = useCallback(
    (next: string | null | ((current: string | null) => string | null)) => {
      const value = typeof next === "function" ? next(selectedTokenId) : next;
      onSelectedTokenChange?.(value);
      if (controlledSelectedTokenId === undefined) {
        setInternalSelectedTokenId(value);
      }
    },
    [controlledSelectedTokenId, onSelectedTokenChange, selectedTokenId],
  );
  const updateSelectedTokenIdRef = useRef(updateSelectedTokenId);
  const localCharacterIds = useMemo(
    () =>
      new Set((props.localCharacters ?? []).map((character) => character.id)),
    [props.localCharacters],
  );
  const movementGrid = scene.gridConfig ?? EMPTY_GRID;
  const blockedTiles = useMemo(
    () => blockedTilesForGrid(movementGrid),
    [movementGrid],
  );
  const selectedToken = selectedTokenId
    ? (tokens[selectedTokenId] ?? null)
    : null;
  const selectedMovableToken =
    selectedToken &&
    canControlToken({
      token: selectedToken,
      localCharacterIds,
      combat,
    })
      ? selectedToken
      : null;
  const selectedMovementRemaining = selectedMovableToken
    ? combat.active
      ? Math.max(
          0,
          movementAllowanceForToken(selectedMovableToken, combat) -
            movementSpentForToken(combat, selectedMovableToken.id),
        )
      : tokenMovement(selectedMovableToken)
    : 0;
  const movementTiles = useMemo(() => {
    if (!selectedMovableToken) return [];
    const allTokens = Object.values(tokens);
    if (!combat.active) {
      return freeMovementTilesForToken(
        selectedMovableToken.id,
        allTokens,
        movementGrid,
      );
    }
    const movementTokens = allTokens.map((token) =>
      token.id === selectedMovableToken.id
        ? { ...token, movement: selectedMovementRemaining }
        : token,
    );
    return movementRangeForToken(
      selectedMovableToken.id,
      movementTokens,
      movementGrid,
    );
  }, [
    combat.active,
    movementGrid,
    selectedMovableToken,
    selectedMovementRemaining,
    tokens,
  ]);

  useEffect(() => {
    propsRef.current = props;
  }, [props]);

  useEffect(() => {
    updateSelectedTokenIdRef.current = updateSelectedTokenId;
  }, [updateSelectedTokenId]);

  // mount Pixi
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let cancelled = false;
    const cleanups: Array<() => void> = [];
    const app = new Application();
    appRef.current = app;

    (async () => {
      await app.init({
        background: 0x0e0d0a,
        resizeTo: el,
        antialias: true,
      });
      if (cancelled) {
        app.destroy(true);
        return;
      }
      el.appendChild(app.canvas);

      const world = new Container();
      worldRef.current = world;
      app.stage.addChild(world);

      const surface = new Graphics();
      surface.eventMode = "static";
      world.addChild(surface);

      // map surface + grid
      const grid = new Graphics();
      world.addChild(grid);
      const blockedOverlay = new Graphics();
      blockedOverlayRef.current = blockedOverlay;
      world.addChild(blockedOverlay);
      const movementOverlay = new Graphics();
      movementOverlayRef.current = movementOverlay;
      world.addChild(movementOverlay);
      const drawGrid = () => {
        surface.clear();
        surface.rect(0, 0, MAP_WIDTH, MAP_HEIGHT);
        surface.fill({ color: 0x11100c, alpha: 0.96 });
        surface.stroke({ width: 2, color: 0x5a4017, alpha: 0.75 });

        grid.clear();
        grid.setStrokeStyle({ width: 1, color: GRID_COLOR, alpha: GRID_ALPHA });
        for (let i = 0; i <= MAP_COLUMNS; i++) {
          grid.moveTo(i * CELL, 0);
          grid.lineTo(i * CELL, MAP_HEIGHT);
        }
        for (let j = 0; j <= MAP_ROWS; j++) {
          grid.moveTo(0, j * CELL);
          grid.lineTo(MAP_WIDTH, j * CELL);
        }
        grid.stroke();
        const bg = backgroundRef.current;
        if (bg) fitBackground(bg);
        if (!cameraTouchedRef.current) resetCamera(app, world);
      };
      drawGrid();
      app.renderer.on("resize", drawGrid);
      cleanups.push(() => app.renderer.off("resize", drawGrid));
      setPixiReadyVersion((version) => version + 1);

      surface.on("pointerdown", (event: FederatedPointerEvent) => {
        if (event.button !== 0 || event.shiftKey) {
          return;
        }
        const selected = movementRef.current.selectedTokenId;
        if (!selected) return;
        const tile = eventToTile(event, world);
        const destination = movementRef.current.destinations.get(tileKey(tile));
        if (!destination) return;
        void moveToken(propsRef.current, selected, destination).then((ok) => {
          if (ok) {
            updateSelectedTokenIdRef.current((current) =>
              current === selected ? null : current,
            );
          }
        });
      });

      // pan + zoom
      let panning = false;
      let startX = 0;
      let startY = 0;
      let originX = 0;
      let originY = 0;
      const onPointerDown = (e: PointerEvent) => {
        if (e.button !== 1 && !e.shiftKey) return;
        cameraTouchedRef.current = true;
        panning = true;
        startX = e.clientX;
        startY = e.clientY;
        originX = world.x;
        originY = world.y;
      };
      const onPointerMove = (e: PointerEvent) => {
        if (!panning) return;
        world.x = originX + (e.clientX - startX);
        world.y = originY + (e.clientY - startY);
      };
      const onPointerUp = () => {
        panning = false;
      };
      const onWheel = (e: WheelEvent) => {
        e.preventDefault();
        cameraTouchedRef.current = true;
        const before = screenToWorld(app, world, e.clientX, e.clientY);
        const factor = e.deltaY < 0 ? 1.1 : 0.9;
        const zoom = Math.max(
          MIN_ZOOM,
          Math.min(MAX_ZOOM, world.scale.x * factor),
        );
        world.scale.set(zoom);
        const after = screenToWorld(app, world, e.clientX, e.clientY);
        world.x += (after.x - before.x) * zoom;
        world.y += (after.y - before.y) * zoom;
      };

      el.addEventListener("pointerdown", onPointerDown);
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
      el.addEventListener("wheel", onWheel, { passive: false });
      cleanups.push(() => el.removeEventListener("pointerdown", onPointerDown));
      cleanups.push(() =>
        window.removeEventListener("pointermove", onPointerMove),
      );
      cleanups.push(() => window.removeEventListener("pointerup", onPointerUp));
      cleanups.push(() => el.removeEventListener("wheel", onWheel));
    })();

    const tokenSprites = tokenSpritesRef.current;
    return () => {
      cancelled = true;
      cleanups.forEach((fn) => fn());
      const a = appRef.current;
      appRef.current = null;
      if (a) {
        try {
          a.destroy(true, { children: true });
        } catch {
          /* */
        }
      }
      tokenSprites.clear();
      worldRef.current = null;
      backgroundRef.current = null;
      movementOverlayRef.current = null;
      blockedOverlayRef.current = null;
    };
  }, []);

  // sync scene background separately so tactical view updates after scene_set.
  useEffect(() => {
    const world = worldRef.current;
    const app = appRef.current;
    if (!world || !app) return;

    const nextUrl = scene.tacticalMapUrl ?? scene.backgroundUrl ?? null;
    const seq = ++backgroundSeqRef.current;

    if (!nextUrl) {
      backgroundRef.current?.destroy();
      backgroundRef.current = null;
      return;
    }

    void Assets.load(nextUrl)
      .then((texture: Texture) => {
        if (
          backgroundSeqRef.current !== seq ||
          worldRef.current !== world ||
          appRef.current !== app
        ) {
          return;
        }
        let bg = backgroundRef.current;
        if (!bg) {
          bg = new Sprite(texture);
          bg.label = "background";
          bg.alpha = scene.tacticalMapUrl ? 0.9 : 0.58;
          backgroundRef.current = bg;
          world.addChildAt(bg, 1);
        } else {
          bg.texture = texture;
          bg.alpha = scene.tacticalMapUrl ? 0.9 : 0.58;
        }
        fitBackground(bg);
      })
      .catch(() => {
        if (backgroundSeqRef.current === seq) {
          backgroundRef.current?.destroy();
          backgroundRef.current = null;
        }
      });
  }, [pixiReadyVersion, scene.backgroundUrl, scene.tacticalMapUrl]);

  // sync tokens
  useEffect(() => {
    const world = worldRef.current;
    if (!world) return;
    const map = tokenSpritesRef.current;

    // Add / update
    for (const t of Object.values(tokens)) {
      let c = map.get(t.id);
      if (!c) {
        c = renderToken(t);
        world.addChild(c);
        map.set(t.id, c);
        syncTokenImage(c as TokenContainer, t);
      } else {
        animateTokenTo(c, t);
        updateHpBar(c, t);
        updateStatusBadges(c, t);
        updateInitials(c, t);
        syncTokenImage(c as TokenContainer, t);
      }
      const canSelect =
        canSelectToken({
          token: t,
          localCharacterIds,
          combat,
        }) && !props.readOnly;
      configureTokenSelection(c, t, canSelect, () => {
        updateSelectedTokenId((current) => (current === t.id ? null : t.id));
      });
    }
    // Remove stale
    for (const [id, c] of map.entries()) {
      if (!tokens[id]) {
        c.destroy({ children: true });
        map.delete(id);
      }
    }
  }, [
    combat,
    localCharacterIds,
    pixiReadyVersion,
    tokens,
    updateSelectedTokenId,
    props.readOnly,
  ]);

  useEffect(() => {
    if (
      selectedTokenId &&
      (!tokens[selectedTokenId] ||
        !canSelectToken({
          token: tokens[selectedTokenId],
          localCharacterIds,
          combat,
        }))
    ) {
      updateSelectedTokenId(null);
    }
  }, [
    combat,
    localCharacterIds,
    selectedTokenId,
    tokens,
    updateSelectedTokenId,
  ]);

  useEffect(() => {
    movementRef.current = {
      selectedTokenId: selectedToken?.id ?? null,
      destinations: new Map(
        movementTiles.map((tile) => [tileKey(tile), tile] as const),
      ),
    };
    drawMovementOverlay(
      movementOverlayRef.current,
      selectedToken,
      movementTiles,
    );
  }, [movementTiles, pixiReadyVersion, selectedToken]);

  useEffect(() => {
    drawBlockedOverlay(blockedOverlayRef.current, blockedTiles);
  }, [blockedTiles, pixiReadyVersion]);

  return (
    <div className="relative h-full w-full overflow-hidden bg-gradient-to-br from-ink-500 via-ink-600 to-ink-500">
      <div ref={ref} className="h-full w-full" style={{ cursor: "grab" }} />
      <div className="bg-ink-600/78 pointer-events-none absolute left-4 top-4 rounded-md border border-brass-700/50 px-3 py-1.5 font-display text-xs uppercase tracking-[0.22em] text-brass-300 shadow-brass">
        {combat.active
          ? props.role === "host"
            ? "Kampfkarte · Host"
            : "Kampfkarte"
          : "Erkundungskarte"}
      </div>
      <div className="pointer-events-none absolute bottom-4 left-4 max-w-[calc(100%-2rem)] truncate rounded-md border border-brass-700/40 bg-ink-600/70 px-3 py-1 font-display text-[11px] uppercase tracking-[0.18em] text-ink-100">
        {selectedToken
          ? `${selectedToken.name} · Bewegung ${movementLabel(
              selectedToken,
              combat,
            )}`
          : scene.tacticalMapUrl
            ? "Battlemap"
            : "Raster"}
      </div>
    </div>
  );
}

function teamColor(team: Token["team"]): number {
  if (team === "player") return 0x9c7bd6;
  if (team === "npc") return 0xc39a4e;
  return 0x8a1a1a;
}

function renderToken(t: Token): Container {
  const c = new Container();
  c.x = t.x * CELL;
  c.y = t.y * CELL;

  const ring = new Graphics();
  ring.circle(CELL / 2, CELL / 2, CELL * 0.42);
  ring.fill({ color: 0x191814, alpha: 0.85 });
  ring.stroke({ width: 3, color: teamColor(t.team), alpha: 0.95 });
  c.addChild(ring);

  const label = new Text({
    text: t.name.slice(0, 2).toUpperCase(),
    style: {
      fontFamily: "Cinzel, serif",
      fontSize: 28,
      fill: 0xfbf6e9,
    },
  });
  label.label = "initials";
  label.anchor.set(0.5);
  label.x = CELL / 2;
  label.y = CELL / 2;
  c.addChild(label);

  const status = new Text({
    text: "",
    style: {
      fontFamily: "Cinzel, serif",
      fontSize: 11,
      fill: 0xe6d29a,
      stroke: { color: 0x0e0d0a, width: 3 },
    },
  });
  status.label = "status";
  status.anchor.set(0.5, 0);
  status.x = CELL / 2;
  status.y = 1;
  c.addChild(status);
  updateStatusBadges(c, t);

  const hp = new Graphics();
  hp.label = "hp";
  c.addChild(hp);
  updateHpBar(c, t);

  return c;
}

function configureTokenSelection(
  c: Container,
  t: Token,
  canSelect: boolean,
  onSelect: (event: FederatedPointerEvent) => void,
) {
  c.removeAllListeners("pointerdown");
  c.eventMode = canSelect ? "static" : "none";
  c.cursor = canSelect ? "pointer" : "default";
  if (!canSelect) return;
  c.on("pointerdown", (event: FederatedPointerEvent) => {
    event.stopPropagation();
    onSelect(event);
  });
  c.label = t.id;
}

function syncTokenImage(c: TokenContainer, t: Token) {
  const nextUrl = t.assetUrl ?? null;
  if (c.assetUrl === nextUrl) return;
  c.assetUrl = nextUrl;
  c.assetSeq = (c.assetSeq ?? 0) + 1;
  const seq = c.assetSeq;

  const existing = c.getChildByLabel("tokenImage") as Sprite | null;
  const initials = c.getChildByLabel("initials") as Text | null;

  if (!nextUrl) {
    existing?.destroy();
    if (initials) initials.visible = true;
    return;
  }

  void Assets.load(nextUrl)
    .then((texture: Texture) => {
      if (!c.parent || c.assetSeq !== seq) return;
      let sprite = c.getChildByLabel("tokenImage") as Sprite | null;
      if (!sprite) {
        sprite = new Sprite(texture);
        sprite.label = "tokenImage";
        sprite.anchor.set(0.5);
        sprite.x = CELL / 2;
        sprite.y = CELL / 2;
        c.addChildAt(sprite, 1);
      } else {
        sprite.texture = texture;
      }
      const size = CELL * 0.74;
      const scale = size / Math.max(texture.width, texture.height);
      sprite.width = texture.width * scale;
      sprite.height = texture.height * scale;
      if (initials) initials.visible = false;
    })
    .catch(() => {
      if (initials) initials.visible = true;
    });
}

function updateHpBar(c: Container, t: Token) {
  const hp = c.getChildByLabel("hp") as Graphics | null;
  if (!hp) return;
  const ratio = t.maxHp > 0 ? Math.max(0, Math.min(1, t.hp / t.maxHp)) : 1;
  hp.clear();
  hp.rect(9, CELL - 10, CELL - 18, 6);
  hp.fill({ color: 0x191814, alpha: 0.8 });
  hp.rect(9, CELL - 10, (CELL - 18) * ratio, 6);
  hp.fill({
    color: ratio > 0.5 ? 0xc39a4e : ratio > 0.2 ? 0xb89345 : 0x8a1a1a,
  });
}

function updateStatusBadges(c: Container, t: Token) {
  const status = c.getChildByLabel("status") as Text | null;
  if (!status) return;
  const text = (t.statuses ?? [])
    .map((s) => s.condition.trim().slice(0, 3).toUpperCase())
    .filter(Boolean)
    .join(" ");
  status.text = text;
  status.visible = Boolean(text);
}

function updateInitials(c: Container, t: Token) {
  const initials = c.getChildByLabel("initials") as Text | null;
  if (!initials) return;
  initials.text = t.name.slice(0, 2).toUpperCase();
}

function drawMovementOverlay(
  overlay: Graphics | null,
  selectedToken: Token | null,
  movementTiles: MovementTile[],
) {
  if (!overlay) return;
  overlay.clear();
  if (!selectedToken) return;

  for (const tile of movementTiles) {
    overlay.rect(tile.x * CELL + 3, tile.y * CELL + 3, CELL - 6, CELL - 6);
    overlay.fill({ color: MOVE_FILL, alpha: 0.28 });
    overlay.stroke({ width: 1, color: MOVE_STROKE, alpha: 0.5 });
  }

  overlay.rect(
    selectedToken.x * CELL + 4,
    selectedToken.y * CELL + 4,
    CELL - 8,
    CELL - 8,
  );
  overlay.fill({ color: SELECTED_FILL, alpha: 0.24 });
  overlay.stroke({ width: 3, color: SELECTED_STROKE, alpha: 0.92 });
}

function drawBlockedOverlay(
  overlay: Graphics | null,
  blockedTiles: MovementTile[],
) {
  if (!overlay) return;
  overlay.clear();
  for (const tile of blockedTiles) {
    overlay.rect(tile.x * CELL + 6, tile.y * CELL + 6, CELL - 12, CELL - 12);
    overlay.fill({ color: 0x0e0d0a, alpha: 0.38 });
    overlay.stroke({ width: 1, color: 0x8a1a1a, alpha: 0.42 });
  }
}

function canControlToken(input: {
  token: Token;
  localCharacterIds: Set<string>;
  combat: CombatState;
}) {
  if (!input.localCharacterIds.has(input.token.id)) return false;
  if (!input.combat.active) return true;
  return isActiveTurnForToken({
    initiative: input.combat.initiative,
    turnIndex: input.combat.turnIndex,
    token: input.token,
  });
}

function canSelectToken(input: {
  token: Token;
  localCharacterIds: Set<string>;
  combat: CombatState;
}) {
  if (input.combat.active) return true;
  return canControlToken(input);
}

function movementSpentForToken(combat: CombatState, tokenId: string) {
  return Math.max(0, Math.floor(combat.movementSpent?.[tokenId] ?? 0));
}

function movementLabel(token: Token, combat: CombatState) {
  if (!combat.active) return "frei";
  const movement = movementAllowanceForToken(token, combat);
  const remaining = Math.max(
    0,
    movement - movementSpentForToken(combat, token.id),
  );
  return remaining === movement ? String(movement) : `${remaining}/${movement}`;
}

function movementAllowanceForToken(token: Token, combat: CombatState) {
  return (
    tokenMovement(token) +
    Math.max(0, Math.floor(combat.resources?.[token.id]?.movementBonus ?? 0))
  );
}

function animateTokenTo(c: Container, t: Token) {
  const targetX = t.x * CELL;
  const targetY = t.y * CELL;
  if (c.x === targetX && c.y === targetY) return;
  const start = performance.now();
  const fromX = c.x;
  const fromY = c.y;
  const dur = 320;
  const step = (now: number) => {
    const k = Math.min(1, (now - start) / dur);
    const eased = 1 - Math.pow(1 - k, 3);
    c.x = fromX + (targetX - fromX) * eased;
    c.y = fromY + (targetY - fromY) * eased;
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function fitBackground(bg: Sprite) {
  const tex = bg.texture;
  if (!tex.width || !tex.height) return;
  const scale = Math.max(MAP_WIDTH / tex.width, MAP_HEIGHT / tex.height);
  bg.scale.set(scale);
  bg.x = (MAP_WIDTH - tex.width * scale) / 2;
  bg.y = (MAP_HEIGHT - tex.height * scale) / 2;
}

function resetCamera(app: Application, world: Container) {
  const scale =
    app.screen.width < 700 ? 0.74 : app.screen.height < 640 ? 0.9 : 1;
  world.scale.set(scale);
  world.x = Math.round((app.screen.width - MAP_WIDTH * scale) / 2);
  world.y = app.screen.height < 640 ? 8 : 16;
}

function screenToWorld(
  app: Application,
  world: Container,
  clientX: number,
  clientY: number,
) {
  const rect = app.canvas.getBoundingClientRect();
  return {
    x: (clientX - rect.left - world.x) / world.scale.x,
    y: (clientY - rect.top - world.y) / world.scale.y,
  };
}

function eventToTile(event: FederatedPointerEvent, world: Container) {
  return {
    x: Math.floor((event.global.x - world.x) / world.scale.x / CELL),
    y: Math.floor((event.global.y - world.y) / world.scale.y / CELL),
  };
}

async function moveToken(
  props: Props,
  tokenId: string,
  pos: { x: number; y: number },
) {
  const path = props.inviteToken
    ? `/api/invite/sessions/${props.sessionId}/move-token/${encodeURIComponent(
        props.inviteToken,
      )}`
    : `/api/sessions/${props.sessionId}/move-token`;
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      tokenId,
      x: pos.x,
      y: pos.y,
      requestId: requestId(),
    }),
  }).catch(() => null);
  return Boolean(res?.ok);
}

function requestId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}
