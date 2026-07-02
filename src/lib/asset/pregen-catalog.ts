export type PregenAssetKind = "monster_token" | "npc_portrait" | "npc_token";
export type PregenAssetGroup = "monster" | "npc";

export type PregenAssetSpec = {
  slug: string;
  label: string;
  group: PregenAssetGroup;
  kind: PregenAssetKind;
  aliases: string[];
  keywords: string[];
  prompt: string;
};

export const PREGEN_ASSET_ROOT = "/assets/pregen";

const STYLE =
  "premium fantasy virtual tabletop asset, brass and parchment UI style, painterly but clean, readable at small size, no text, no letters, no logo";

const TOKEN_STYLE =
  "top-down circular creature token, centered full body silhouette, transparent-feeling neutral dark parchment ground, strong rim light, clean edge separation";

const PORTRAIT_STYLE =
  "cinematic half-body character portrait, front three-quarter view, expressive face, parchment and brass palette, dark vignette background";

type BaseSpec = {
  slug: string;
  label: string;
  aliases?: string[];
  keywords?: string[];
  prompt: string;
};

const monsterBases: BaseSpec[] = [
  monster(
    "goblin",
    "Goblin",
    "small wiry green goblin raider with crude blade",
  ),
  monster(
    "kobold",
    "Kobold",
    "small reptilian kobold trapper with spear and scraps of armor",
  ),
  monster("orc", "Orc", "broad brutal orc warrior with tusks and battered axe"),
  monster(
    "hobgoblin",
    "Hobgoblin",
    "disciplined hobgoblin soldier in dark red lamellar armor",
  ),
  monster(
    "bugbear",
    "Bugbear",
    "hulking bugbear ambusher with shaggy fur and spiked club",
  ),
  monster("gnoll", "Gnoll", "hyena-headed gnoll marauder with jagged spear"),
  monster(
    "skeleton",
    "Skeleton",
    "animated skeleton warrior with rusted sword and cracked shield",
  ),
  monster(
    "zombie",
    "Zombie",
    "rotting zombie shambling forward in torn burial clothes",
  ),
  monster(
    "ghoul",
    "Ghoul",
    "gaunt corpse-eating ghoul with long claws and feral posture",
  ),
  monster(
    "wight",
    "Wight",
    "ancient armored wight with cold eyes and grave-worn mail",
  ),
  monster(
    "specter",
    "Specter",
    "translucent hostile ghostly specter with ragged trailing form",
  ),
  monster("shadow", "Shadow", "living humanoid shadow with smoky claws"),
  monster(
    "giant-rat",
    "Giant Rat",
    "large diseased rat with bristled fur and yellow eyes",
    ["rat"],
  ),
  monster("wolf", "Wolf", "lean grey wolf lunging low with bared teeth"),
  monster(
    "dire-wolf",
    "Dire Wolf",
    "massive dire wolf with heavy shoulders and icy eyes",
  ),
  monster(
    "giant-spider",
    "Giant Spider",
    "huge black forest spider with long legs and venomous fangs",
    ["spider"],
  ),
  monster(
    "giant-wolf-spider",
    "Giant Wolf Spider",
    "hairy giant wolf spider crouched to pounce",
  ),
  monster(
    "giant-snake",
    "Giant Snake",
    "coiled giant constrictor snake with patterned scales",
  ),
  monster(
    "giant-centipede",
    "Giant Centipede",
    "long armored giant centipede with venom mandibles",
  ),
  monster(
    "giant-bat",
    "Giant Bat",
    "large cave bat with outstretched leathery wings",
  ),
  monster(
    "black-bear",
    "Black Bear",
    "powerful black bear rearing with claws visible",
  ),
  monster(
    "brown-bear",
    "Brown Bear",
    "massive brown bear charging through underbrush",
  ),
  monster("panther", "Panther", "sleek black panther stalking from shadow"),
  monster(
    "owlbear",
    "Owlbear",
    "ferocious owlbear with hooked beak, feathers, and bear claws",
  ),
  monster("ogre", "Ogre", "huge ogre brute carrying a tree trunk club"),
  monster(
    "troll",
    "Troll",
    "long-limbed green troll with regenerating scars and claws",
  ),
  monster(
    "minotaur",
    "Minotaur",
    "muscular bull-headed minotaur with greataxe",
  ),
  monster("gargoyle", "Gargoyle", "winged stone gargoyle crouched with talons"),
  monster("harpy", "Harpy", "vicious harpy with ragged wings and clawed feet"),
  monster(
    "manticore",
    "Manticore",
    "lion-bodied manticore with bat wings and spiked tail",
  ),
  monster(
    "griffon",
    "Griffon",
    "eagle-headed griffon with tawny lion body and wings",
  ),
  monster(
    "gelatinous-cube",
    "Gelatinous Cube",
    "transparent acidic cube containing bones and gear",
  ),
  monster(
    "ankheg",
    "Ankheg",
    "burrowing insectoid ankheg with chitin plates and mandibles",
  ),
  monster(
    "giant-scorpion",
    "Giant Scorpion",
    "armored giant scorpion with raised stinger",
  ),
  monster(
    "air-elemental",
    "Air Elemental",
    "spiraling humanoid vortex of wind and debris",
  ),
  monster(
    "earth-elemental",
    "Earth Elemental",
    "hulking humanoid elemental made of stone and soil",
  ),
  monster(
    "fire-elemental",
    "Fire Elemental",
    "humanoid fire elemental made of living flame",
  ),
  monster(
    "water-elemental",
    "Water Elemental",
    "surging humanoid elemental made of dark water",
  ),
  monster(
    "young-red-dragon",
    "Young Red Dragon",
    "young red dragon coiled with smoke and ember light",
  ),
  monster(
    "young-green-dragon",
    "Young Green Dragon",
    "young green dragon with poison mist and forest shadows",
  ),
  monster(
    "black-dragon-wyrmling",
    "Black Dragon Wyrmling",
    "small black dragon wyrmling with acid-scarred horns",
  ),
  monster(
    "bandit",
    "Bandit",
    "rough human bandit with hood, short sword, and leather armor",
  ),
  monster(
    "cultist",
    "Cultist",
    "masked cultist in dark ritual robes holding a curved dagger",
  ),
  monster("guard", "Guard", "armored town guard with spear and round shield"),
  monster(
    "scout",
    "Scout",
    "wilderness scout with bow, cloak, and light leather armor",
  ),
];

const npcBases: BaseSpec[] = [
  npc(
    "innkeeper",
    "Innkeeper",
    "warm tavern innkeeper with rolled sleeves and brass keys",
  ),
  npc(
    "merchant",
    "Merchant",
    "sharp-eyed traveling merchant in layered robes with coin purse",
  ),
  npc(
    "blacksmith",
    "Blacksmith",
    "soot-marked village blacksmith with leather apron and hammer",
  ),
  npc("guard", "Guard", "steady city guard captain in practical armor"),
  npc(
    "noble",
    "Noble",
    "composed noble courtier in embroidered dark formalwear",
  ),
  npc(
    "priest",
    "Priest",
    "calm temple priest with simple vestments and holy symbol",
  ),
  npc(
    "healer",
    "Healer",
    "kind battlefield healer with satchel of herbs and bandages",
  ),
  npc(
    "mage",
    "Mage",
    "reserved arcane mage with ink-stained fingers and spellbook",
  ),
  npc(
    "apprentice-wizard",
    "Apprentice Wizard",
    "young nervous wizard apprentice carrying too many scrolls",
  ),
  npc(
    "ranger",
    "Ranger",
    "weathered ranger in green cloak with bow and travel gear",
  ),
  npc("hunter", "Hunter", "practical local hunter with fur mantle and longbow"),
  npc(
    "sailor",
    "Sailor",
    "salt-weathered sailor with rope belt and storm coat",
  ),
  npc(
    "captain",
    "Captain",
    "confident ship or mercenary captain with worn command coat",
  ),
  npc("thief", "Thief", "quick street thief in dark hood with cautious grin"),
  npc(
    "assassin",
    "Assassin",
    "cold professional assassin in matte black leather",
  ),
  npc(
    "bard",
    "Bard",
    "charismatic bard with lute, bright scarf, and knowing smile",
  ),
  npc("farmer", "Farmer", "tired but sturdy farmer in plain work clothes"),
  npc(
    "village-elder",
    "Village Elder",
    "wise village elder with lined face and carved staff",
  ),
  npc(
    "scholar",
    "Scholar",
    "bookish scholar with spectacles, notes, and travel cloak",
  ),
  npc(
    "cult-leader",
    "Cult Leader",
    "magnetic cult leader in ceremonial robes with unsettling calm",
  ),
  npc(
    "necromancer",
    "Necromancer",
    "pale necromancer with bone charms and black robes",
  ),
  npc("knight", "Knight", "honorable knight in worn plate with heraldic cloak"),
  npc(
    "bandit-captain",
    "Bandit Captain",
    "dangerous bandit captain with scarred face and fine stolen coat",
  ),
  npc(
    "stablehand",
    "Stablehand",
    "young stablehand with straw in hair and patched jacket",
  ),
];

function monster(
  slug: string,
  label: string,
  subject: string,
  aliases: string[] = [],
): BaseSpec {
  return {
    slug,
    label,
    aliases,
    keywords: [label, subject],
    prompt: `${TOKEN_STYLE}, ${subject}. ${STYLE}.`,
  };
}

function npc(
  slug: string,
  label: string,
  subject: string,
  aliases: string[] = [],
): BaseSpec {
  return {
    slug,
    label,
    aliases,
    keywords: [label, subject],
    prompt: subject,
  };
}

export const PREGEN_MONSTER_TOKENS: PregenAssetSpec[] = monsterBases.map(
  (base) => ({
    ...base,
    group: "monster",
    kind: "monster_token",
    aliases: [base.label, base.slug, ...(base.aliases ?? [])],
    keywords: base.keywords ?? [],
  }),
);

export const PREGEN_NPC_PORTRAITS: PregenAssetSpec[] = npcBases.map((base) => ({
  ...base,
  group: "npc",
  kind: "npc_portrait",
  aliases: [base.label, base.slug, ...(base.aliases ?? [])],
  keywords: base.keywords ?? [],
  prompt: `${PORTRAIT_STYLE}, ${base.prompt}. ${STYLE}.`,
}));

export const PREGEN_NPC_TOKENS: PregenAssetSpec[] = npcBases.map((base) => ({
  ...base,
  group: "npc",
  kind: "npc_token",
  aliases: [base.label, base.slug, ...(base.aliases ?? [])],
  keywords: base.keywords ?? [],
  prompt: `${TOKEN_STYLE}, ${base.prompt}. ${STYLE}.`,
}));

export const PREGEN_ASSETS: PregenAssetSpec[] = [
  ...PREGEN_MONSTER_TOKENS,
  ...PREGEN_NPC_PORTRAITS,
  ...PREGEN_NPC_TOKENS,
];

export function pregenAssetUrl(spec: PregenAssetSpec): string {
  const folder = spec.group === "monster" ? "monsters" : "npcs";
  const variant = spec.kind.endsWith("_portrait") ? "portrait" : "token";
  return `${PREGEN_ASSET_ROOT}/${folder}/${spec.slug}-${variant}.png`;
}

export function findPregenAsset(
  kind: PregenAssetKind,
  search: {
    name?: string | null;
    role?: string | null;
    description?: string | null;
    excludeSlugs?: readonly string[];
  },
): PregenAssetSpec | null {
  const nameText = normalize(search.name ?? "");
  const roleText = normalize(search.role ?? "");
  const descriptionText = normalize(search.description ?? "");
  const query = normalize([nameText, roleText, descriptionText].join(" "));
  if (!query) return null;
  const primaryTokens = new Set([...tokens(nameText), ...tokens(roleText)]);
  const descriptionTokens = new Set(tokens(descriptionText));
  const excluded = new Set(search.excludeSlugs ?? []);
  const minScore = minPregenScore(kind);

  let best: { spec: PregenAssetSpec; score: number } | null = null;
  for (const spec of PREGEN_ASSETS) {
    if (spec.kind !== kind) continue;
    if (excluded.has(spec.slug)) continue;
    let score = 0;

    for (const alias of spec.aliases) {
      const aliasText = normalize(alias);
      const aliasTokens = tokens(aliasText);
      if (aliasTokens.length === 0) continue;

      if (nameText === aliasText || roleText === aliasText) score += 140;
      if (containsAllTokens(primaryTokens, aliasTokens)) {
        score += aliasTokens.length > 1 ? 110 : 90;
      } else if (
        aliasTokens.length > 1 &&
        containsAllTokens(descriptionTokens, aliasTokens)
      ) {
        score += 45;
      }
    }

    const specTokens = new Set(
      tokens(
        [spec.slug, spec.label, ...spec.aliases, ...spec.keywords].join(" "),
      ),
    );
    for (const token of primaryTokens) {
      if (specTokens.has(token)) score += 12;
    }
    for (const token of descriptionTokens) {
      if (specTokens.has(token)) score += 3;
    }

    if (score >= minScore && (!best || score > best.score)) {
      best = { spec, score };
    }
  }
  return best?.spec ?? null;
}

function minPregenScore(_kind: PregenAssetKind): number {
  return 70;
}

function containsAllTokens(
  haystack: ReadonlySet<string>,
  needle: readonly string[],
): boolean {
  return needle.length > 0 && needle.every((token) => haystack.has(token));
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokens(value: string): string[] {
  return normalize(value)
    .split(/\s+/)
    .filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "the",
  "of",
  "with",
  "from",
  "local",
  "generic",
  "npc",
  "monster",
  "creature",
]);
