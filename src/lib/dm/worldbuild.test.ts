import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  campaignCreate: vi.fn(),
  nPCCreate: vi.fn(),
  locationCreate: vi.fn(),
  itemCreate: vi.fn(),
  encounterCreate: vi.fn(),
  sceneCreate: vi.fn(),
  campaignLoreSourceCreateMany: vi.fn(),
  campaignUpdate: vi.fn(),
}));
const llm = vi.hoisted(() => ({
  completeDmJsonObject: vi.fn(),
}));

vi.mock("../db", () => ({
  prisma: {
    campaign: { create: db.campaignCreate, update: db.campaignUpdate },
    nPC: { create: db.nPCCreate, update: vi.fn() },
    location: { create: db.locationCreate, update: vi.fn() },
    item: { create: db.itemCreate, update: vi.fn() },
    encounter: { create: db.encounterCreate },
    scene: { create: db.sceneCreate },
    campaignLoreSource: { createMany: db.campaignLoreSourceCreateMany },
    asset: { count: vi.fn() },
  },
}));

vi.mock("../asset/library", () => ({
  createOrReuseCampaignAsset: vi.fn().mockResolvedValue({ asset: null }),
}));

vi.mock("./llm", () => ({
  completeDmJsonObject: llm.completeDmJsonObject,
}));

describe("commitBlueprint lore persistence", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("stores lore bible and lore source rows", async () => {
    db.campaignCreate.mockResolvedValue({ id: "camp_1" });
    db.nPCCreate.mockResolvedValue({ id: "npc_1" });
    db.locationCreate.mockResolvedValue({ id: "loc_1" });
    db.itemCreate.mockResolvedValue({ id: "item_1" });

    const { commitBlueprint } = await import("./worldbuild");
    await commitBlueprint({
      hostId: "user_1",
      input: {
        title: "Mira",
        theme: "private novel",
        partySize: 4,
        partyLevel: 3,
        sessionLengthHours: 3,
      },
      loreBible: {
        sourceTitles: ["novel.md"],
        canonFacts: ["Mira is the heir."],
        characters: [],
        locations: [],
        timeline: [],
        toneAndThemes: [],
        adaptationRules: [],
        forbiddenContradictions: [],
        campaignHooks: [],
        uncertainties: [],
        citations: [],
      },
      loreSources: [
        {
          kind: "upload",
          title: "novel.md",
          rawText: "Private text",
          summary: "A private novel.",
          facts: ["Mira is the heir."],
          citations: [],
          contentHash: "a".repeat(64),
        },
      ],
      blueprint: minimalBlueprint,
    });

    expect(db.campaignCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          world: expect.objectContaining({
            create: expect.objectContaining({
              loreBible: expect.objectContaining({
                canonFacts: ["Mira is the heir."],
              }),
            }),
          }),
        }),
      }),
    );
    expect(db.campaignLoreSourceCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            campaignId: "camp_1",
            kind: "upload",
            title: "novel.md",
          }),
        ],
      }),
    );
    expect(db.sceneCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ title: "Auftakt" }),
      }),
    );
  });

  it("accepts titled setup beats and rejects beats without a title", async () => {
    const { draftBlueprint } = await import("./worldbuild");
    const input = {
      title: "Mira",
      theme: "private novel",
      partySize: 4,
      partyLevel: 3,
      sessionLengthHours: 3,
    };

    llm.completeDmJsonObject.mockResolvedValue(minimalBlueprint);
    await expect(draftBlueprint("user_1", input)).resolves.toMatchObject({
      openingScene: {
        introPlan: {
          setupBeats: minimalBlueprint.openingScene.introPlan.setupBeats,
        },
      },
    });

    llm.completeDmJsonObject.mockResolvedValue({
      ...minimalBlueprint,
      openingScene: {
        ...minimalBlueprint.openingScene,
        introPlan: {
          ...minimalBlueprint.openingScene.introPlan,
          setupBeats: [
            minimalBlueprint.openingScene.introPlan.setupBeats[0],
            { text: "Diesem einzelnen Setup-Beat fehlt der Titel." },
            minimalBlueprint.openingScene.introPlan.setupBeats[2],
          ],
        },
      },
    });
    await expect(draftBlueprint("user_1", input)).rejects.toThrow();
  });
});

const minimalBlueprint = {
  title: "Mira",
  logline: "A private novel becomes an adventure.",
  tone: "heroic",
  styleSuffix: "painterly fantasy",
  plot: {
    act1: { summary: "Start", beats: [] },
    act2: { summary: "Middle", beats: [] },
    act3: { summary: "End", beats: [] },
    branchingPoints: [],
  },
  factions: [],
  npcs: [
    {
      id: "npc_mira",
      name: "Mira",
      role: "heir",
      personality: "",
      voice: "",
      appearance: "",
      secret: null,
    },
  ],
  locations: [
    {
      id: "loc_home",
      name: "Home",
      description: "",
      ambience: "",
      visualPrompt: "",
      tacticalNotes: "",
    },
  ],
  items: [],
  encounters: [],
  openingScene: {
    locationId: "loc_home",
    summary: "Opening",
    presentNpcIds: ["npc_mira"],
    hook: "Begin",
    introPlan: {
      establishingShot: "A quiet road.",
      setupBeats: [
        {
          title: "Ankunft im Regen",
          text: "Regen zeichnet helle Spuren auf die Scheiben.",
        },
        {
          title: "Blicke am Tresen",
          text: "Elinor Hale mustert die Neuankömmlinge.",
        },
        {
          title: "Die erste Wahl",
          text: "Vor der Hintertür fällt ein schwerer Gegenstand zu Boden.",
        },
      ],
      characterHookStyle: "Ask each player.",
      objective: "Find the truth.",
      stakes: "The realm falls.",
      firstPrompt: "Was tut ihr?",
    },
  },
};
