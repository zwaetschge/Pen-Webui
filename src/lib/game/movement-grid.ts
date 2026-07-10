import { prisma } from "../db";
import {
  TACTICAL_MAP_COLUMNS,
  TACTICAL_MAP_ROWS,
  normalizeMovementGrid,
  type MovementGrid,
} from "./movement";
import { BOOTSTRAP_EVENT_TYPES } from "./events";

const SCENE_GRID_EVENTS = ["scene_set", ...BOOTSTRAP_EVENT_TYPES];

export async function movementGridForSession(input: {
  sessionId: string;
  campaignId: string;
  locationId: string | null;
}): Promise<MovementGrid> {
  const direct = await locationGrid(input.campaignId, input.locationId);
  if (direct) return withDefaultBounds(direct);

  const liveScene = await prisma.eventLog.findFirst({
    where: {
      sessionId: input.sessionId,
      type: { in: SCENE_GRID_EVENTS },
    },
    orderBy: { ts: "desc" },
    select: { payload: true },
  });
  const payload =
    liveScene?.payload &&
    typeof liveScene.payload === "object" &&
    !Array.isArray(liveScene.payload)
      ? (liveScene.payload as Record<string, unknown>)
      : {};
  const fromPayload = normalizeMovementGrid(payload.gridConfig);
  if (fromPayload) return withDefaultBounds(fromPayload);

  const locationId =
    typeof payload.locationId === "string" ? payload.locationId : null;
  const sceneGrid = await locationGrid(input.campaignId, locationId);
  return withDefaultBounds(sceneGrid);
}

async function locationGrid(campaignId: string, locationId: string | null) {
  if (!locationId) return undefined;
  const location = await prisma.location.findFirst({
    where: { id: locationId, campaignId },
    select: { gridConfig: true },
  });
  return normalizeMovementGrid(location?.gridConfig);
}

function withDefaultBounds(grid: MovementGrid | undefined): MovementGrid {
  return {
    columns: TACTICAL_MAP_COLUMNS,
    rows: TACTICAL_MAP_ROWS,
    ...grid,
  };
}
