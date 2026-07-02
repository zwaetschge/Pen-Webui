const plotActOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    beats: {
      type: "array",
      items: { type: "string" },
    },
  },
  required: ["summary", "beats"],
} as const;

export const worldbuildOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string" },
    logline: { type: "string" },
    tone: { type: "string" },
    styleSuffix: { type: "string" },
    plot: {
      type: "object",
      additionalProperties: false,
      properties: {
        act1: plotActOutputSchema,
        act2: plotActOutputSchema,
        act3: plotActOutputSchema,
        branchingPoints: {
          type: "array",
          items: { type: "string" },
        },
      },
      required: ["act1", "act2", "act3", "branchingPoints"],
    },
    factions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          agenda: { type: "string" },
          state: { type: "string" },
        },
        required: ["name", "agenda", "state"],
      },
    },
    npcs: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          role: { type: "string" },
          personality: { type: "string" },
          voice: { type: "string" },
          appearance: { type: "string" },
          secret: { type: ["string", "null"] },
        },
        required: [
          "id",
          "name",
          "role",
          "personality",
          "voice",
          "appearance",
          "secret",
        ],
      },
    },
    locations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          description: { type: "string" },
          ambience: { type: "string" },
          visualPrompt: { type: "string" },
          tacticalNotes: { type: "string" },
        },
        required: [
          "id",
          "name",
          "description",
          "ambience",
          "visualPrompt",
          "tacticalNotes",
        ],
      },
    },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          description: { type: "string" },
          visualPrompt: { type: "string" },
        },
        required: ["id", "name", "description", "visualPrompt"],
      },
    },
    encounters: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          locationId: { type: "string" },
          monsters: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                srdName: { type: "string" },
                count: { type: "integer" },
              },
              required: ["srdName", "count"],
            },
          },
          twist: { type: "string" },
        },
        required: ["name", "locationId", "monsters", "twist"],
      },
    },
    openingScene: {
      type: "object",
      additionalProperties: false,
      properties: {
        locationId: { type: "string" },
        summary: { type: "string" },
        presentNpcIds: {
          type: "array",
          items: { type: "string" },
        },
        hook: { type: "string" },
        introPlan: {
          type: "object",
          additionalProperties: false,
          properties: {
            establishingShot: { type: "string" },
            setupBeats: {
              type: "array",
              items: { type: "string" },
            },
            characterHookStyle: { type: "string" },
            objective: { type: "string" },
            stakes: { type: "string" },
            firstPrompt: { type: "string" },
          },
          required: [
            "establishingShot",
            "setupBeats",
            "characterHookStyle",
            "objective",
            "stakes",
            "firstPrompt",
          ],
        },
      },
      required: ["locationId", "summary", "presentNpcIds", "hook", "introPlan"],
    },
  },
  required: [
    "title",
    "logline",
    "tone",
    "styleSuffix",
    "plot",
    "factions",
    "npcs",
    "locations",
    "items",
    "encounters",
    "openingScene",
  ],
} as const;
