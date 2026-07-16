"use client";

import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { cn } from "@/lib/cn";
import { EMPTY_COMBAT_RESOURCES } from "@/lib/game/combat-resources";
import { isActiveTurnForToken } from "@/lib/game/combat-turn";
import type { AbilityDefinition } from "@/lib/game/rules/combat";
import type {
  InventoryItemInstance,
  PartyMember,
  PartyResource,
  RestProposal,
  StructuredQuest,
} from "@/lib/game/rules/party-types";
import { useGame, type Token } from "@/lib/game/store";

type Props = {
  sessionId: string;
  inviteToken?: string;
  role: "host" | "player";
  localCharacters?: Array<{ id: string; name: string }>;
  selectedTokenId?: string | null;
  onSelectedTokenChange?: (tokenId: string | null) => void;
  className?: string;
};

type ConsoleTab = "abilities" | "inventory" | "journal" | "party" | "dm";

type GameplayCharacter = {
  id: string;
  name: string;
  abilities: AbilityDefinition[];
  runtime: unknown;
};

type DialogueVote = {
  optionId: string | null;
  secret: boolean;
};

type DialogueOption = {
  id: string;
  label: string;
  check?: {
    skill: string;
    dc: number;
    eligibleMemberIds?: string[];
    allowAssist: boolean;
    maxAssistants: number;
  };
};

type DialogueView = {
  id: string;
  prompt: string;
  participantIds: string[];
  speakerId: string;
  resolutionMode: "speaker" | "majority";
  optionOrder: string[];
  options: Record<string, DialogueOption>;
  votes: Record<string, DialogueVote>;
  checkAssignments: Record<string, { memberId: string; assistants: string[] }>;
  status: "open" | "resolved" | "cancelled";
};

type PartyView = {
  version: number;
  revision: number;
  members: PartyMember[];
  inventory: InventoryItemInstance[];
  equipment: Record<string, Record<string, string>>;
  resources: Record<string, Record<string, PartyResource>>;
  rest: RestProposal | null;
  quests: StructuredQuest[];
  reputation: Record<string, number>;
  dialogue: DialogueView | null;
};

type GameplayResponse = {
  ok: true;
  actorCharacterId: string | null;
  party: PartyView;
  characters: GameplayCharacter[];
  encounter: {
    id: string;
    round: number;
    activeTurn: number;
    runtime: {
      plans?: Record<
        string,
        {
          abilityId: string;
          targetTokenId?: string;
          targetCell?: { x: number; y: number };
        }
      >;
      reaction?: {
        id: string;
        reactorTokenId: string;
        trigger: string;
        options: string[];
        expiresAt: number;
      } | null;
    };
  } | null;
};

type ReactionView = {
  id: string;
  reactorTokenId: string;
  trigger: string;
  options: string[];
  expiresAt: number;
};

const TABS: Array<{ id: ConsoleTab; label: string; shortLabel: string }> = [
  { id: "abilities", label: "Aktionen", shortLabel: "Aktion" },
  { id: "inventory", label: "Inventar", shortLabel: "Inventar" },
  { id: "journal", label: "Journal", shortLabel: "Journal" },
  { id: "party", label: "Gruppe", shortLabel: "Gruppe" },
  { id: "dm", label: "Codex-DM", shortLabel: "DM" },
];

const QUICK_ROLLS = [
  { label: "W20", notation: "1d20" },
  { label: "Vorteil", notation: "1d20adv" },
  { label: "Nachteil", notation: "1d20dis" },
  { label: "W6", notation: "1d6" },
  { label: "W8", notation: "1d8" },
  { label: "W10", notation: "1d10" },
  { label: "W12", notation: "1d12" },
];

const EMPTY_RESOURCES: Record<string, PartyResource> = {};
const EMPTY_EQUIPMENT: Record<string, string> = {};
const EMPTY_NEXT_ACTIONS: string[] = [];
const EQUIPMENT_SLOTS = [
  "head",
  "armor",
  "main-hand",
  "off-hand",
  "ring-1",
  "ring-2",
];

export function GameplayConsole(props: Props) {
  const localCharacters = props.localCharacters ?? [];
  const [tab, setTab] = useState<ConsoleTab>(() =>
    useGame.getState().combat.active ? "abilities" : "dm",
  );
  const [data, setData] = useState<GameplayResponse | null>(null);
  const [selectedCharacterId, setSelectedCharacterId] = useState(
    localCharacters[0]?.id ?? "",
  );
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const partyRevision = useGame((state) => state.gameplay.partyRevision);
  const liveGameplay = useGame((state) => state.gameplay);
  const combat = useGame((state) => state.combat);
  const tokens = useGame((state) => state.tokens);
  const sessionEnded = useGame((state) => state.sessionEnded);
  const nextActions = useGame(
    (state) => state.scene.nextActions ?? EMPTY_NEXT_ACTIONS,
  );
  const awaitingSkillCheck = useGame((state) => state.awaitingSkillCheck);
  const dmThinking = useGame((state) => state.dmThinking);
  const previousCombatActive = useRef(combat.active);
  const stateUrl = gameplayStateUrl(props.sessionId, props.inviteToken);
  const actionUrl = combatActionUrl(props.sessionId, props.inviteToken);
  const turnUrl = dmTurnUrl(props.sessionId, props.inviteToken);
  const rollUrl = dmRollUrl(props.sessionId, props.inviteToken);

  useEffect(() => {
    if (previousCombatActive.current === combat.active) return;
    previousCombatActive.current = combat.active;
    setTab(combat.active ? "abilities" : "dm");
  }, [combat.active]);

  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      const response = await fetch(stateUrl, {
        method: "GET",
        cache: "no-store",
        signal,
      });
      const body = (await response.json().catch(() => ({}))) as
        | GameplayResponse
        | { error?: unknown; message?: unknown };
      if (!response.ok || !("ok" in body) || body.ok !== true) {
        throw new Error(
          consoleErrorLabel(
            "error" in body ? body.error : null,
            response.status,
            "message" in body ? body.message : null,
          ),
        );
      }
      const gameplay = body as GameplayResponse;
      setData(gameplay);
      setError(null);
      if (gameplay.actorCharacterId) {
        setSelectedCharacterId(gameplay.actorCharacterId);
      } else {
        setSelectedCharacterId((current) =>
          gameplay.characters.some((character) => character.id === current)
            ? current
            : (gameplay.characters[0]?.id ?? ""),
        );
      }
    },
    [stateUrl],
  );

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    refresh(controller.signal)
      .catch((cause) => {
        if (controller.signal.aborted) return;
        setError(
          cause instanceof Error ? cause.message : "Konsole nicht erreichbar",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [partyRevision, refresh]);

  const actorId =
    data?.actorCharacterId ??
    selectedCharacterId ??
    localCharacters[0]?.id ??
    "";
  const actor =
    data?.characters.find((character) => character.id === actorId) ??
    data?.characters[0] ??
    null;
  const actorToken = actor ? actorTokenFor(actor, tokens) : null;
  const selectedToken = props.selectedTokenId
    ? (tokens[props.selectedTokenId] ?? null)
    : null;
  const currentResources = actorId
    ? (data?.party.resources[actorId] ?? EMPTY_RESOURCES)
    : EMPTY_RESOURCES;
  const equipment = actorId
    ? (data?.party.equipment[actorId] ?? EMPTY_EQUIPMENT)
    : EMPTY_EQUIPMENT;
  const combatResources = actorToken
    ? (combat.resources?.[actorToken.id] ?? EMPTY_COMBAT_RESOURCES)
    : EMPTY_COMBAT_RESOURCES;
  const group = liveGameplay.turnGroup;
  const actorTurnAvailable = Boolean(
    combat.active &&
    actorToken &&
    !sessionEnded &&
    (group?.tokenIds.includes(actorToken.id)
      ? !group.completedTokenIds.includes(actorToken.id)
      : isActiveTurnForToken({
          initiative: combat.initiative,
          turnIndex: combat.turnIndex,
          token: actorToken,
        })),
  );
  const canAct = actorTurnAvailable && Boolean(actorToken && actorToken.hp > 0);
  const canRollDeathSave =
    actorTurnAvailable && Boolean(actorToken && actorToken.hp <= 0);
  const plan = actorToken
    ? (liveGameplay.plans[actorToken.id] ??
      data?.encounter?.runtime.plans?.[actorToken.id] ??
      null)
    : null;
  const reaction =
    liveGameplay.reaction ?? data?.encounter?.runtime.reaction ?? null;
  const visibleReaction =
    reaction &&
    (props.role === "host" ||
      localCharacters.some(
        (character) => character.id === reaction.reactorTokenId,
      ) ||
      actorToken?.id === reaction.reactorTokenId)
      ? reaction
      : null;

  const targetOptions = useMemo(
    () =>
      actorToken
        ? Object.values(tokens)
            .filter((token) =>
              isVisibleCombatTarget({
                actor: actorToken,
                candidate: token,
                hiddenTokenIds: liveGameplay.hiddenTokenIds,
                host: props.role === "host",
              }),
            )
            .sort((left, right) =>
              left.team === actorToken.team && right.team !== actorToken.team
                ? 1
                : left.team !== actorToken.team &&
                    right.team === actorToken.team
                  ? -1
                  : left.name.localeCompare(right.name, "de"),
            )
        : [],
    [actorToken, liveGameplay.hiddenTokenIds, props.role, tokens],
  );
  const visibleSelectedToken =
    selectedToken &&
    targetOptions.some((token) => token.id === selectedToken.id)
      ? selectedToken
      : null;

  const postGameplay = useCallback(
    async (
      key: string,
      command: Record<string, unknown>,
      successMessage?: string,
    ) => {
      if (pending || sessionEnded) return false;
      setPending(key);
      setError(null);
      setNotice(null);
      try {
        const response = await fetch(stateUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...command, commandId: requestId() }),
        });
        const body = (await response.json().catch(() => ({}))) as {
          error?: unknown;
          message?: unknown;
          party?: PartyView;
        };
        if (!response.ok) {
          throw new Error(
            consoleErrorLabel(body.error, response.status, body.message),
          );
        }
        if (body.party) {
          setData((current) =>
            current ? { ...current, party: body.party! } : current,
          );
        }
        if (successMessage) setNotice(successMessage);
        return true;
      } catch (cause) {
        setError(
          cause instanceof Error ? cause.message : "Befehl fehlgeschlagen",
        );
        return false;
      } finally {
        setPending(null);
      }
    },
    [pending, sessionEnded, stateUrl],
  );

  const postCombat = useCallback(
    async (
      key: string,
      command: Record<string, unknown>,
      successMessage?: string,
      keepalive = false,
    ) => {
      if ((pending && !keepalive) || sessionEnded) return false;
      if (!keepalive) setPending(key);
      setError(null);
      setNotice(null);
      try {
        const response = await fetch(actionUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...command, requestId: requestId() }),
          keepalive,
        });
        const body = (await response.json().catch(() => ({}))) as {
          error?: unknown;
          message?: unknown;
        };
        if (!response.ok) {
          throw new Error(
            consoleErrorLabel(body.error, response.status, body.message),
          );
        }
        if (successMessage) setNotice(successMessage);
        return true;
      } catch (cause) {
        if (!keepalive) {
          setError(
            cause instanceof Error ? cause.message : "Aktion fehlgeschlagen",
          );
        }
        return false;
      } finally {
        if (!keepalive) setPending(null);
      }
    },
    [actionUrl, pending, sessionEnded],
  );

  const postTurn = useCallback(
    async (text: string, characterId?: string) => {
      if (pending || sessionEnded || !text.trim()) return false;
      setPending("dm:turn");
      setError(null);
      setNotice(null);
      try {
        const response = await fetch(turnUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            text: text.trim(),
            ...(characterId ? { characterId } : {}),
          }),
        });
        const body = (await response.json().catch(() => ({}))) as {
          error?: unknown;
          message?: unknown;
          queued?: unknown;
          position?: unknown;
        };
        if (!response.ok) {
          throw new Error(
            consoleErrorLabel(body.error, response.status, body.message),
          );
        }
        setNotice(
          body.queued === true
            ? queuedTurnLabel(body.position)
            : "Aktion an den Codex-DM gesendet",
        );
        return true;
      } catch (cause) {
        setError(
          cause instanceof Error
            ? cause.message
            : "Aktion konnte nicht gesendet werden",
        );
        return false;
      } finally {
        setPending(null);
      }
    },
    [pending, sessionEnded, turnUrl],
  );

  const postRoll = useCallback(
    async (notation: string, reason?: string, characterId?: string) => {
      if (pending || sessionEnded) return false;
      setPending("dm:roll");
      setError(null);
      setNotice(null);
      try {
        const response = await fetch(rollUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            notation,
            ...(reason ? { reason } : {}),
            ...(characterId ? { characterId } : {}),
          }),
        });
        const body = (await response.json().catch(() => ({}))) as {
          error?: unknown;
          message?: unknown;
        };
        if (!response.ok) {
          throw new Error(
            consoleErrorLabel(body.error, response.status, body.message),
          );
        }
        setNotice(reason ? `${reason} gewürfelt` : `${notation} gewürfelt`);
        return true;
      } catch (cause) {
        setError(
          cause instanceof Error
            ? cause.message
            : "Wurf konnte nicht gesendet werden",
        );
        return false;
      } finally {
        setPending(null);
      }
    },
    [pending, rollUrl, sessionEnded],
  );

  async function useAbility(ability: AbilityDefinition) {
    if (!actorToken || actorToken.hp <= 0) return;
    const targetTokenId = targetIdForAbility(
      ability,
      actorToken,
      visibleSelectedToken,
    );
    const mode = abilityActionMode({
      combatActive: combat.active,
      canAct,
      completed: group?.completedTokenIds.includes(actorToken.id) ?? false,
    });
    if (mode === "blocked") return;
    const planned = mode === "plan_action";
    await postCombat(
      `${mode}:${ability.id}`,
      {
        type: mode,
        actorTokenId: actorToken.id,
        abilityId: ability.id,
        ...(targetTokenId ? { targetTokenId } : {}),
      },
      planned ? `${ability.name} vorgemerkt` : `${ability.name} ausgelöst`,
    );
  }

  return (
    <section
      aria-label="Gameplay-Konsole"
      className={cn(
        "gameplay-console relative flex max-h-[64dvh] min-h-0 shrink-0 flex-col overflow-hidden border-t border-brass-400/45 bg-ink-700/95 shadow-[0_-18px_50px_rgba(0,0,0,0.56)]",
        props.className,
      )}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-parchment-300/80 to-transparent" />
      <ConsoleHeader
        actor={actor}
        role={props.role}
        characters={data?.characters ?? []}
        selectedCharacterId={actorId}
        onCharacterChange={setSelectedCharacterId}
        combatActive={combat.active}
        round={combat.round}
        resources={combatResources}
        connected={!loading && Boolean(data)}
      />

      {visibleReaction ? (
        <ReactionPrompt
          reaction={visibleReaction}
          abilities={actor?.abilities ?? []}
          disabled={Boolean(pending)}
          onRespond={(choice, automatic) =>
            postCombat(
              `reaction:${choice}`,
              {
                type: "respond_reaction",
                actorTokenId: visibleReaction.reactorTokenId,
                reactionId: visibleReaction.id,
                reactionChoice: choice,
              },
              choice === "pass" ? "Reaktion passiert" : "Reaktion gewählt",
              automatic,
            )
          }
        />
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3 pb-4 sm:px-4">
        {loading && !data ? <ConsoleLoading /> : null}
        {!loading && !data ? (
          <ConsoleEmpty onRetry={() => refresh().catch(() => undefined)} />
        ) : null}
        {data && tab === "abilities" ? (
          <AbilitiesPanel
            actor={actor}
            actorToken={actorToken}
            selectedToken={visibleSelectedToken}
            targets={targetOptions}
            canAct={canAct}
            combatActive={combat.active}
            completed={
              actorToken
                ? (group?.completedTokenIds.includes(actorToken.id) ?? false)
                : false
            }
            plan={plan}
            objects={liveGameplay.objects}
            resources={currentResources}
            combatResources={combatResources}
            canRollDeathSave={canRollDeathSave}
            pending={pending}
            onTargetChange={props.onSelectedTokenChange}
            onUseAbility={useAbility}
            onInteract={(objectId, objectAction) =>
              actorToken
                ? postCombat(
                    `interact:${objectId}:${objectAction}`,
                    {
                      type: "interact",
                      actorTokenId: actorToken.id,
                      objectId,
                      objectAction,
                    },
                    "Umgebung genutzt",
                  )
                : Promise.resolve(false)
            }
            onDeathSave={() =>
              actorToken
                ? postCombat(
                    `death-save:${actorToken.id}`,
                    {
                      type: "death_save",
                      actorTokenId: actorToken.id,
                    },
                    "Todesrettungswurf ausgeführt",
                  )
                : Promise.resolve(false)
            }
            onEndTurn={() =>
              actorToken
                ? postCombat(
                    `end-turn:${actorToken.id}`,
                    { type: "end_turn", actorTokenId: actorToken.id },
                    "Zug beendet",
                  )
                : Promise.resolve(false)
            }
          />
        ) : null}
        {data && tab === "inventory" ? (
          <InventoryPanel
            actorId={actorId}
            items={data.party.inventory}
            equipment={equipment}
            pending={pending}
            onCommand={postGameplay}
          />
        ) : null}
        {data && tab === "journal" ? (
          <JournalPanel
            quests={data.party.quests}
            clues={liveGameplay.privateClues}
            reputation={data.party.reputation}
          />
        ) : null}
        {data && tab === "party" ? (
          <PartyPanel
            role={props.role}
            actorId={actorId}
            members={data.party.members}
            resources={currentResources}
            rest={data.party.rest}
            dialogue={data.party.dialogue}
            pending={pending}
            onCommand={postGameplay}
          />
        ) : null}
        {data && tab === "dm" ? (
          <DmPanel
            actorId={actorId}
            actorName={actor?.name ?? null}
            role={props.role}
            nextActions={nextActions}
            awaitingSkillCheck={awaitingSkillCheck}
            dmThinking={dmThinking}
            pending={pending}
            sessionEnded={sessionEnded}
            onTurn={postTurn}
            onRoll={postRoll}
          />
        ) : null}
      </div>

      {error || notice ? (
        <div
          role={error ? "alert" : "status"}
          aria-live="polite"
          className={cn(
            "border-t px-3 py-2 text-xs sm:px-4",
            error
              ? "border-blood-500/45 bg-blood-600/20 text-parchment-100"
              : "border-brass-700/40 bg-brass-900/50 text-brass-300",
          )}
        >
          {error ?? notice}
        </div>
      ) : null}

      <nav
        aria-label="Konsolenbereiche"
        className="grid grid-cols-5 border-t border-brass-700/55 bg-ink-800/95 pb-[max(0.35rem,env(safe-area-inset-bottom))]"
      >
        {TABS.map((item, index) => (
          <button
            key={item.id}
            type="button"
            aria-current={tab === item.id ? "page" : undefined}
            onClick={() => setTab(item.id)}
            className={cn(
              "relative min-h-14 border-r border-brass-900/70 px-1 py-2 font-display text-[9px] uppercase tracking-[0.16em] transition last:border-r-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brass-400",
              tab === item.id
                ? "bg-brass-700/25 text-parchment-100"
                : "text-ink-100 hover:bg-ink-600/70 hover:text-brass-300",
            )}
          >
            <span
              className={cn(
                "mx-auto mb-1 flex h-5 w-5 items-center justify-center rounded-sm border text-[9px]",
                tab === item.id
                  ? "border-brass-400/75 bg-brass-600/35 text-brass-300"
                  : "border-ink-200/25 bg-ink-600 text-ink-100",
              )}
            >
              {index + 1}
            </span>
            <span className="sm:hidden">{item.shortLabel}</span>
            <span className="hidden sm:inline">{item.label}</span>
          </button>
        ))}
      </nav>
    </section>
  );
}

function ConsoleHeader(props: {
  actor: GameplayCharacter | null;
  role: "host" | "player";
  characters: GameplayCharacter[];
  selectedCharacterId: string;
  onCharacterChange: (id: string) => void;
  combatActive: boolean;
  round?: number;
  resources: typeof EMPTY_COMBAT_RESOURCES;
  connected: boolean;
}) {
  return (
    <header className="flex shrink-0 items-center gap-3 border-b border-brass-700/45 bg-[linear-gradient(110deg,rgba(39,26,9,0.72),rgba(8,7,5,0.92)_52%)] px-3 py-2.5 sm:px-4">
      <div
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-sm border font-display text-sm",
          props.connected
            ? "border-brass-400/60 bg-brass-700/30 text-brass-300"
            : "border-ink-200/30 bg-ink-600 text-ink-100",
        )}
        aria-label={
          props.connected ? "Konsole verbunden" : "Verbindung wird hergestellt"
        }
      >
        {props.actor?.name.slice(0, 1).toUpperCase() ?? "P"}
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-display text-[9px] uppercase tracking-[0.24em] text-brass-400">
          {props.combatActive
            ? `Taktik · Runde ${props.round ?? 1}`
            : "Companion-Konsole"}
        </p>
        {props.role === "host" && props.characters.length > 1 ? (
          <select
            aria-label="Aktive Figur"
            value={props.selectedCharacterId}
            onChange={(event) => props.onCharacterChange(event.target.value)}
            className="mt-0.5 w-full max-w-64 border-0 bg-transparent p-0 font-display text-base text-parchment-100 focus:outline-none"
          >
            <option value="" className="bg-ink-700">
              Tischhinweis
            </option>
            {props.characters.map((character) => (
              <option
                key={character.id}
                value={character.id}
                className="bg-ink-700"
              >
                {character.name}
              </option>
            ))}
          </select>
        ) : (
          <p className="truncate font-display text-base text-parchment-100">
            {props.actor?.name ?? "Figur wird geladen"}
          </p>
        )}
      </div>
      {props.combatActive ? (
        <div className="grid grid-cols-3 gap-1 text-center">
          <TurnResource label="A" spent={props.resources.actionUsed} />
          <TurnResource label="B" spent={props.resources.bonusActionUsed} />
          <TurnResource label="R" spent={props.resources.reactionUsed} />
        </div>
      ) : (
        <span className="rounded-sm border border-brass-700/45 bg-ink-600/70 px-2 py-1 font-display text-[9px] uppercase tracking-wider text-ink-100">
          Bereit
        </span>
      )}
    </header>
  );
}

function TurnResource(props: { label: string; spent: boolean }) {
  return (
    <span
      className={cn(
        "flex h-7 w-7 items-center justify-center rounded-sm border font-display text-[9px]",
        props.spent
          ? "border-ink-200/20 bg-ink-600/70 text-ink-200 line-through"
          : "border-brass-400/60 bg-brass-700/30 text-brass-300",
      )}
    >
      {props.label}
    </span>
  );
}

function AbilitiesPanel(props: {
  actor: GameplayCharacter | null;
  actorToken: Token | null;
  selectedToken: Token | null;
  targets: Token[];
  canAct: boolean;
  combatActive: boolean;
  completed: boolean;
  plan: { abilityId: string; targetTokenId?: string } | null;
  objects: Array<Record<string, unknown>>;
  resources: Record<string, PartyResource>;
  combatResources: typeof EMPTY_COMBAT_RESOURCES;
  canRollDeathSave: boolean;
  pending: string | null;
  onTargetChange?: (id: string | null) => void;
  onUseAbility: (ability: AbilityDefinition) => void;
  onInteract: (objectId: string, action: string) => Promise<boolean>;
  onDeathSave: () => Promise<boolean>;
  onEndTurn: () => Promise<boolean>;
}) {
  const abilities = props.actor?.abilities ?? [];
  const plannedAbility = props.plan
    ? abilities.find((ability) => ability.id === props.plan?.abilityId)
    : null;
  const nearbyObjects = props.actorToken
    ? props.objects.filter((object) => {
        const x = Number(object.x);
        const y = Number(object.y);
        return (
          typeof object.id === "string" &&
          object.state !== "destroyed" &&
          Number.isInteger(x) &&
          Number.isInteger(y) &&
          Math.max(
            Math.abs(props.actorToken!.x - x),
            Math.abs(props.actorToken!.y - y),
          ) <= 1
        );
      })
    : [];

  return (
    <div>
      <SectionHeading
        eyebrow={
          props.canRollDeathSave
            ? "Am Boden"
            : props.canAct
              ? "Dein Zug"
              : "Zug vorbereiten"
        }
        title={
          props.canRollDeathSave
            ? "Todesrettung"
            : props.canAct
              ? "Aktion wählen"
              : props.completed
                ? "Zug abgeschlossen"
                : "Aktion vormerken"
        }
        meta={
          plannedAbility
            ? `Geplant: ${plannedAbility.name}`
            : props.combatActive
              ? props.canAct
                ? "Wird sofort ausgeführt"
                : "Wird bei deinem Zug bereitgestellt"
              : "Im Kampf verfügbar"
        }
      />

      {props.combatActive && props.targets.length > 0 ? (
        <div className="mb-3">
          <p className="mb-1.5 font-display text-[9px] uppercase tracking-[0.2em] text-ink-100">
            Zielmarkierung
          </p>
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {props.targets.map((target) => (
              <button
                key={target.id}
                type="button"
                onClick={() => props.onTargetChange?.(target.id)}
                className={cn(
                  "min-h-12 min-w-[7.25rem] rounded-sm border px-2.5 py-2 text-left text-xs",
                  target.id === props.selectedToken?.id
                    ? "border-brass-300/80 bg-brass-700/35 text-parchment-100 shadow-brass"
                    : "border-brass-700/35 bg-ink-600/70 text-ink-100 hover:border-brass-400/60",
                )}
              >
                <span className="block truncate font-display text-[10px] uppercase tracking-wider">
                  {target.name}
                </span>
                <span className="text-ink-200">
                  TP {Math.max(0, target.hp)}/{Math.max(1, target.maxHp)}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {props.combatActive && nearbyObjects.length > 0 ? (
        <div className="mb-3">
          <p className="mb-1.5 font-display text-[9px] uppercase tracking-[0.2em] text-brass-400">
            Umgebung
          </p>
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {nearbyObjects.map((object) => {
              const id = String(object.id);
              const kind = String(object.kind ?? "destructible");
              const state = String(object.state ?? "intact");
              const action =
                kind === "door"
                  ? state === "open"
                    ? "close"
                    : "open"
                  : kind === "trap"
                    ? "disarm"
                    : kind === "barrel" && object.content !== "water"
                      ? "ignite"
                      : "damage";
              return (
                <button
                  key={id}
                  type="button"
                  disabled={!props.canAct || Boolean(props.pending)}
                  onClick={() => void props.onInteract(id, action)}
                  className="min-h-12 min-w-[8rem] rounded-sm border border-brass-700/45 bg-ink-600/70 px-2.5 py-2 text-left text-xs text-parchment-100 hover:border-brass-400/65 disabled:opacity-45"
                >
                  <span className="block truncate font-display text-[9px] uppercase tracking-wider text-brass-300">
                    {String(object.name ?? id)}
                  </span>
                  <span className="text-ink-100">
                    {environmentActionLabel(action)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {abilities.length > 0 ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
          {abilities.map((ability, index) => {
            const targetValid = props.actorToken
              ? validTargetForAbility(
                  ability,
                  props.actorToken,
                  props.selectedToken,
                )
              : ability.target.minTargets === 0;
            const economyAvailable = abilityEconomyAvailable(
              ability,
              props.combatResources,
              props.resources,
            );
            const blocked =
              !props.combatActive ||
              !props.actorToken ||
              props.actorToken.hp <= 0 ||
              props.completed ||
              ability.activation === "passive" ||
              ability.requiresAdjudication ||
              !targetValid ||
              !economyAvailable;
            const planned = props.plan?.abilityId === ability.id;
            const mode = props.canAct ? "Ausführen" : "Vormerken";
            return (
              <article
                key={ability.id}
                className={cn(
                  "relative flex min-h-[8.75rem] flex-col overflow-hidden rounded-sm border bg-[radial-gradient(circle_at_top_right,rgba(164,120,48,0.13),transparent_44%),rgba(14,13,10,0.9)] p-2.5",
                  planned
                    ? "border-brass-300/80 shadow-brass"
                    : "border-brass-700/45",
                )}
              >
                <div className="mb-2 flex items-start justify-between gap-2">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm border border-brass-700/60 bg-ink-800/80 font-display text-[9px] text-brass-300">
                    {index + 1}
                  </span>
                  <span className="rounded-sm border border-ink-200/20 bg-ink-600/80 px-1.5 py-0.5 font-display text-[8px] uppercase tracking-wider text-ink-100">
                    {activationLabel(ability.activation)}
                  </span>
                </div>
                <h3 className="line-clamp-2 font-display text-[11px] uppercase leading-snug tracking-[0.08em] text-parchment-100">
                  {ability.name}
                </h3>
                <p className="mt-1 line-clamp-2 text-[10px] leading-snug text-ink-100">
                  {abilitySummary(ability)}
                </p>
                <button
                  type="button"
                  disabled={blocked || Boolean(props.pending)}
                  onClick={() => props.onUseAbility(ability)}
                  className={cn(
                    "mt-auto min-h-9 rounded-sm border px-2 py-1.5 font-display text-[9px] uppercase tracking-[0.14em] transition",
                    blocked || props.pending
                      ? "cursor-not-allowed border-ink-200/20 bg-ink-600/50 text-ink-200"
                      : planned
                        ? "border-brass-300/80 bg-brass-600/45 text-parchment-100"
                        : "border-brass-400/60 bg-brass-700/30 text-brass-300 hover:bg-brass-600/45 hover:text-parchment-100",
                  )}
                >
                  {ability.requiresAdjudication
                    ? "DM nötig"
                    : !targetValid
                      ? "Ziel wählen"
                      : !economyAvailable
                        ? "Ressource fehlt"
                        : planned
                          ? "Plan ändern"
                          : mode}
                </button>
              </article>
            );
          })}
        </div>
      ) : (
        <EmptyState
          title="Noch keine Fähigkeiten"
          text="Die Fähigkeiten werden aus dem Charakterbogen geladen."
        />
      )}

      {props.combatActive ? (
        <div className="mt-3 grid grid-cols-2 gap-2">
          {props.canRollDeathSave ? (
            <button
              type="button"
              disabled={Boolean(props.pending)}
              onClick={() => void props.onDeathSave()}
              className="col-span-2 min-h-12 rounded-sm border border-blood-500/70 bg-blood-600/25 px-3 py-2 font-display text-[10px] uppercase tracking-[0.16em] text-parchment-100 hover:bg-blood-600/40 disabled:opacity-45"
            >
              Todesrettungswurf
            </button>
          ) : null}
          <button
            type="button"
            disabled={!props.canAct || Boolean(props.pending)}
            onClick={() => void props.onEndTurn()}
            className={cn(
              "min-h-11 rounded-sm border px-3 py-2 font-display text-[9px] uppercase tracking-[0.16em]",
              props.canRollDeathSave ? "hidden" : "col-start-2",
              props.canAct
                ? "border-brass-400/60 bg-ink-600/75 text-brass-300 hover:bg-brass-700/30"
                : "cursor-not-allowed border-ink-200/20 bg-ink-600/45 text-ink-200",
            )}
          >
            Zug beenden
          </button>
        </div>
      ) : null}
    </div>
  );
}

function DmPanel(props: {
  actorId: string;
  actorName: string | null;
  role: "host" | "player";
  nextActions: string[];
  awaitingSkillCheck: {
    characterId: string;
    skill: string;
    dc: number;
    reason?: string;
  } | null;
  dmThinking: boolean;
  pending: string | null;
  sessionEnded: boolean;
  onTurn: (text: string, characterId?: string) => Promise<boolean>;
  onRoll: (
    notation: string,
    reason?: string,
    characterId?: string,
  ) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const disabled = Boolean(props.pending) || props.sessionEnded;

  async function send() {
    const text = draft.trim();
    if (!text || disabled) return;
    if (text.startsWith("/r ")) {
      const notation = text.slice(3).trim();
      if (!notation) return;
      if (await props.onRoll(notation, undefined, props.actorId || undefined)) {
        setDraft("");
      }
      return;
    }
    if (await props.onTurn(text, props.actorId || undefined)) setDraft("");
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    void send();
  }

  function chooseAction(action: string) {
    setDraft(action);
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  }

  return (
    <div>
      <SectionHeading
        eyebrow="Codex-DM"
        title="Freie Aktion"
        meta={
          props.dmThinking
            ? "DM arbeitet · Aktion wird vorgemerkt"
            : props.actorName
              ? `Als ${props.actorName}`
              : "An den ganzen Tisch"
        }
      />

      {props.awaitingSkillCheck ? (
        <section className="mb-3 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-sm border border-arcane-400/55 bg-arcane-600/15 px-3 py-2.5">
          <div className="min-w-0">
            <p className="font-display text-[9px] uppercase tracking-[0.2em] text-arcane-400">
              Probe angefordert
            </p>
            <p className="mt-0.5 truncate text-sm text-parchment-100">
              {props.awaitingSkillCheck.skill} · SG{" "}
              {props.awaitingSkillCheck.dc}
            </p>
            {props.awaitingSkillCheck.reason ? (
              <p className="mt-0.5 line-clamp-2 text-[10px] text-ink-100">
                {props.awaitingSkillCheck.reason}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            disabled={disabled}
            onClick={() =>
              void props.onRoll(
                "1d20",
                `Probe: ${props.awaitingSkillCheck!.skill}`,
                props.awaitingSkillCheck!.characterId,
              )
            }
            className="min-h-11 rounded-sm border border-arcane-400/65 bg-arcane-600/30 px-3 py-2 font-display text-[9px] uppercase tracking-wider text-parchment-100 hover:bg-arcane-500/40 disabled:opacity-45"
          >
            W20 würfeln
          </button>
        </section>
      ) : null}

      {props.nextActions.length > 0 ? (
        <section className="mb-3">
          <p className="mb-1.5 font-display text-[9px] uppercase tracking-[0.2em] text-brass-400">
            Vorschläge
          </p>
          <div className="grid gap-1.5 sm:grid-cols-3">
            {props.nextActions.slice(0, 3).map((action, index) => (
              <button
                key={`${index}:${action}`}
                type="button"
                disabled={disabled}
                title={action}
                onClick={() => chooseAction(action)}
                className="grid min-h-12 grid-cols-[1.5rem_minmax(0,1fr)] items-start gap-2 rounded-sm border border-brass-700/40 bg-ink-600/65 px-2.5 py-2 text-left text-xs leading-snug text-parchment-100 hover:border-brass-400/65 hover:bg-brass-900/35 disabled:opacity-45"
              >
                <span className="flex h-6 w-6 items-center justify-center rounded-sm border border-brass-700/60 bg-ink-800/75 font-display text-[9px] text-brass-300">
                  {index + 1}
                </span>
                <span className="line-clamp-3">{action}</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <div className="rounded-sm border border-brass-600/45 bg-[linear-gradient(145deg,rgba(90,64,23,0.17),rgba(8,7,5,0.82))] p-2">
        <textarea
          ref={textareaRef}
          aria-label="Aktion für den Codex-DM beschreiben"
          rows={3}
          value={draft}
          disabled={disabled}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={
            props.actorName
              ? `Was tut ${props.actorName}?`
              : props.role === "host"
                ? "Tischhinweis an den Codex-DM"
                : "Beschreibe deine Aktion"
          }
          className="min-h-20 w-full resize-none rounded-sm border border-brass-700/45 bg-ink-700/75 px-3 py-2.5 text-base leading-relaxed text-parchment-100 placeholder:text-ink-200 focus:border-brass-400/70 focus:outline-none disabled:opacity-55"
        />
        <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
          <p className="text-[10px] text-ink-200">
            Enter sendet · Shift+Enter schreibt weiter · /r 1d20 würfelt
          </p>
          <button
            type="button"
            disabled={disabled || !draft.trim()}
            onClick={() => void send()}
            className="min-h-11 rounded-sm border border-brass-400/65 bg-brass-700/40 px-4 py-2 font-display text-[9px] uppercase tracking-[0.14em] text-parchment-100 hover:bg-brass-600/45 disabled:cursor-not-allowed disabled:border-ink-200/20 disabled:bg-ink-600/50 disabled:text-ink-200"
          >
            {props.pending === "dm:turn"
              ? "Sendet"
              : props.dmThinking
                ? "Vormerken"
                : "Senden"}
          </button>
        </div>
      </div>

      <details className="mt-3 rounded-sm border border-brass-700/35 bg-ink-600/45">
        <summary className="flex min-h-11 cursor-pointer items-center justify-between px-3 py-2 font-display text-[9px] uppercase tracking-[0.2em] text-brass-400">
          Schnellwürfe
          <span className="text-ink-200">7 Würfel</span>
        </summary>
        <div className="flex flex-wrap gap-1.5 border-t border-brass-700/30 p-2">
          {QUICK_ROLLS.map((roll) => (
            <button
              key={roll.label}
              type="button"
              disabled={disabled}
              onClick={() =>
                void props.onRoll(
                  roll.notation,
                  undefined,
                  props.actorId || undefined,
                )
              }
              className="min-h-10 rounded-sm border border-brass-700/50 bg-ink-700/70 px-3 py-2 font-display text-[9px] uppercase tracking-wider text-brass-300 hover:border-brass-400/70 hover:bg-brass-900/45 disabled:opacity-45"
            >
              {roll.label}
            </button>
          ))}
        </div>
      </details>
    </div>
  );
}

function InventoryPanel(props: {
  actorId: string;
  items: InventoryItemInstance[];
  equipment: Record<string, string>;
  pending: string | null;
  onCommand: (
    key: string,
    command: Record<string, unknown>,
    successMessage?: string,
  ) => Promise<boolean>;
}) {
  const itemById = new Map(props.items.map((item) => [item.instanceId, item]));
  const heldItems = props.items.filter(
    (item) => item.holderId === props.actorId || item.holderId === "party",
  );

  return (
    <div>
      <SectionHeading
        eyebrow="Ausrüstung"
        title="Inventar verwalten"
        meta={`${heldItems.length} Gegenstände verfügbar`}
      />
      <div className="mb-4 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
        {EQUIPMENT_SLOTS.map((slot) => {
          const item = props.equipment[slot]
            ? itemById.get(props.equipment[slot])
            : null;
          return (
            <button
              key={slot}
              type="button"
              disabled={!item || Boolean(props.pending)}
              onClick={() =>
                item
                  ? props.onCommand(
                      `unequip:${slot}`,
                      {
                        type: "inventory.unequip",
                        memberId: props.actorId,
                        slot,
                      },
                      `${item.name} abgelegt`,
                    )
                  : undefined
              }
              className={cn(
                "min-h-14 rounded-sm border px-2 py-2 text-left",
                item
                  ? "border-brass-600/50 bg-brass-900/45 hover:border-brass-400/70"
                  : "cursor-default border-ink-200/15 bg-ink-600/35",
              )}
            >
              <span className="block font-display text-[8px] uppercase tracking-[0.18em] text-ink-200">
                {slotLabel(slot)}
              </span>
              <span className="mt-1 block truncate text-xs text-parchment-100">
                {item?.name ?? "Leer"}
              </span>
            </button>
          );
        })}
      </div>

      <div className="space-y-1.5">
        {heldItems.map((item) => {
          const partyItem = item.holderId === "party";
          const equippable =
            !partyItem &&
            !item.equipped &&
            item.quantity === 1 &&
            item.equippableSlots.length > 0;
          return (
            <article
              key={item.instanceId}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-sm border border-brass-700/35 bg-ink-600/65 px-3 py-2.5"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="truncate text-sm text-parchment-100">
                    {item.name}
                  </h3>
                  {item.quantity > 1 ? (
                    <span className="rounded-sm border border-ink-200/20 px-1.5 text-[10px] text-ink-100">
                      {item.quantity}×
                    </span>
                  ) : null}
                </div>
                <p className="mt-0.5 text-[10px] uppercase tracking-wider text-ink-200">
                  {partyItem
                    ? "Gruppenvorrat"
                    : item.equipped
                      ? `Angelegt · ${slotLabel(item.equipped.slot)}`
                      : item.usable
                        ? "Verbrauchsgegenstand"
                        : item.equippableSlots.length
                          ? "Ausrüstung"
                          : "Gegenstand"}
                </p>
              </div>
              <div className="flex gap-1">
                {partyItem ? (
                  <ItemButton
                    label="Nehmen"
                    disabled={Boolean(props.pending) || !props.actorId}
                    onClick={() =>
                      props.onCommand(
                        `take:${item.instanceId}`,
                        {
                          type: "inventory.transfer",
                          itemId: item.instanceId,
                          toHolderId: props.actorId,
                        },
                        `${item.name} übernommen`,
                      )
                    }
                  />
                ) : null}
                {equippable ? (
                  <ItemButton
                    label="Anlegen"
                    disabled={Boolean(props.pending)}
                    onClick={() =>
                      props.onCommand(
                        `equip:${item.instanceId}`,
                        {
                          type: "inventory.equip",
                          memberId: props.actorId,
                          itemId: item.instanceId,
                          slot: item.equippableSlots[0],
                        },
                        `${item.name} angelegt`,
                      )
                    }
                  />
                ) : null}
                {item.usable && !partyItem && !item.equipped ? (
                  <ItemButton
                    label="Nutzen"
                    disabled={Boolean(props.pending)}
                    onClick={() =>
                      props.onCommand(
                        `use:${item.instanceId}`,
                        {
                          type: "inventory.use",
                          memberId: props.actorId,
                          itemId: item.instanceId,
                          quantity: 1,
                        },
                        `${item.name} verwendet`,
                      )
                    }
                  />
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
      {heldItems.length === 0 ? (
        <EmptyState
          title="Inventar leer"
          text="Beute und Gruppenvorräte erscheinen hier automatisch."
        />
      ) : null}
    </div>
  );
}

function ItemButton(props: {
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={props.disabled}
      onClick={props.onClick}
      className="min-h-9 rounded-sm border border-brass-600/55 bg-brass-800/45 px-2 py-1 font-display text-[8px] uppercase tracking-wider text-brass-300 hover:border-brass-400/70 hover:text-parchment-100 disabled:cursor-not-allowed disabled:opacity-45"
    >
      {props.label}
    </button>
  );
}

function JournalPanel(props: {
  quests: StructuredQuest[];
  clues: Array<{ id: string; text: string; ts: number }>;
  reputation: Record<string, number>;
}) {
  const quests = [...props.quests].sort(
    (left, right) =>
      questStatusRank(left.status) - questStatusRank(right.status),
  );
  return (
    <div>
      <SectionHeading
        eyebrow="Kampagnenjournal"
        title="Aufträge und Entdeckungen"
        meta={`${quests.filter((quest) => quest.status === "active").length} aktive Aufträge`}
      />
      <div className="space-y-2">
        {quests.map((quest) => {
          const progress = questProgress(quest);
          return (
            <article
              key={quest.id}
              className="rounded-sm border border-brass-700/40 bg-ink-600/65 p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-display text-[8px] uppercase tracking-[0.2em] text-brass-400">
                    {questStatusLabel(quest.status)}
                  </p>
                  <h3 className="mt-0.5 font-display text-sm text-parchment-100">
                    {quest.title}
                  </h3>
                </div>
                <span className="font-display text-[10px] text-ink-100">
                  {progress.completed}/{progress.total}
                </span>
              </div>
              {quest.description ? (
                <p className="mt-2 text-xs leading-relaxed text-ink-100">
                  {quest.description}
                </p>
              ) : null}
              <div className="mt-3 h-1 overflow-hidden rounded-full bg-ink-800">
                <div
                  className="h-full bg-gradient-to-r from-brass-700 to-brass-300 transition-[width]"
                  style={{ width: `${progress.percent}%` }}
                />
              </div>
              <ul className="mt-2 space-y-1.5">
                {quest.objectiveOrder.map((objectiveId) => {
                  const objective = quest.objectives[objectiveId];
                  if (!objective) return null;
                  return (
                    <li
                      key={objective.id}
                      className="flex items-start gap-2 text-xs text-ink-100"
                    >
                      <span
                        className={cn(
                          "mt-1 h-2 w-2 shrink-0 rounded-full border",
                          objective.status === "completed"
                            ? "border-brass-300 bg-brass-400"
                            : objective.status === "failed"
                              ? "border-blood-500 bg-blood-600"
                              : "border-ink-200/60",
                        )}
                      />
                      <span
                        className={
                          objective.status === "completed"
                            ? "line-through opacity-70"
                            : ""
                        }
                      >
                        {objective.title}
                        {objective.target > 1
                          ? ` · ${objective.progress}/${objective.target}`
                          : ""}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </article>
          );
        })}
      </div>
      {quests.length === 0 ? (
        <EmptyState
          title="Noch keine Aufträge"
          text="Codex führt wichtige Ziele und Folgen eurer Entscheidungen hier zusammen."
        />
      ) : null}

      <Subheading title="Private Hinweise" count={props.clues.length} />
      <div className="space-y-1.5">
        {[...props.clues].reverse().map((clue) => (
          <article
            key={clue.id}
            className="border-l-2 border-arcane-400/65 bg-arcane-600/10 px-3 py-2"
          >
            <p className="text-xs leading-relaxed text-parchment-100">
              {clue.text}
            </p>
            <time className="mt-1 block font-display text-[8px] uppercase tracking-wider text-ink-200">
              Nur für dich · {shortTime(clue.ts)}
            </time>
          </article>
        ))}
      </div>
      {props.clues.length === 0 ? (
        <p className="text-xs text-ink-200">
          Verdeckte Wahrnehmungen und persönliche Erkenntnisse erscheinen hier.
        </p>
      ) : null}

      {Object.keys(props.reputation).length > 0 ? (
        <>
          <Subheading
            title="Ansehen"
            count={Object.keys(props.reputation).length}
          />
          <div className="grid grid-cols-2 gap-1.5">
            {Object.entries(props.reputation).map(([faction, value]) => (
              <div
                key={faction}
                className="rounded-sm border border-brass-700/35 bg-ink-600/55 px-2.5 py-2"
              >
                <p className="truncate font-display text-[9px] uppercase tracking-wider text-ink-100">
                  {humanizeId(faction)}
                </p>
                <p className="mt-1 text-sm text-brass-300">
                  {value > 0 ? "+" : ""}
                  {value}
                </p>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

function PartyPanel(props: {
  role: "host" | "player";
  actorId: string;
  members: PartyMember[];
  resources: Record<string, PartyResource>;
  rest: RestProposal | null;
  dialogue: DialogueView | null;
  pending: string | null;
  onCommand: (
    key: string,
    command: Record<string, unknown>,
    successMessage?: string,
  ) => Promise<boolean>;
}) {
  return (
    <div>
      {props.dialogue ? (
        <DialoguePanel
          actorId={props.actorId}
          dialogue={props.dialogue}
          members={props.members}
          pending={props.pending}
          onCommand={props.onCommand}
        />
      ) : null}
      <RestPanel
        role={props.role}
        actorId={props.actorId}
        members={props.members}
        resources={props.resources}
        rest={props.rest}
        pending={props.pending}
        onCommand={props.onCommand}
      />
    </div>
  );
}

function DialoguePanel(props: {
  actorId: string;
  dialogue: DialogueView;
  members: PartyMember[];
  pending: string | null;
  onCommand: (
    key: string,
    command: Record<string, unknown>,
    successMessage?: string,
  ) => Promise<boolean>;
}) {
  const options = dialogueOptions(props.dialogue);
  const ownVote = props.dialogue.votes[props.actorId]?.optionId ?? null;
  const actorIsSpeaker = props.dialogue.speakerId === props.actorId;
  const speaker = props.members.find(
    (member) => member.id === props.dialogue.speakerId,
  );
  const selectedOption =
    options.find((option) => option.id === ownVote) ?? null;
  const assignment = ownVote
    ? props.dialogue.checkAssignments[ownVote]
    : undefined;
  const eligibleCheckers = selectedOption?.check
    ? props.members.filter(
        (member) =>
          member.active &&
          props.dialogue.participantIds.includes(member.id) &&
          (!selectedOption.check?.eligibleMemberIds?.length ||
            selectedOption.check.eligibleMemberIds.includes(member.id)),
      )
    : [];
  const checkerId = assignment?.memberId ?? props.dialogue.speakerId;
  const checkerReady = eligibleCheckers.some(
    (member) => member.id === checkerId,
  );
  const actorAssisting =
    assignment?.assistants.includes(props.actorId) ?? false;
  const canAssist = Boolean(
    selectedOption?.check?.allowAssist &&
    assignment &&
    props.actorId &&
    assignment.memberId !== props.actorId &&
    props.dialogue.participantIds.includes(props.actorId),
  );
  return (
    <section className="mb-5 rounded-sm border border-arcane-400/45 bg-[radial-gradient(circle_at_top,rgba(74,50,121,0.23),transparent_56%),rgba(14,13,10,0.82)] p-3 shadow-[0_12px_32px_rgba(0,0,0,0.28)]">
      <p className="font-display text-[9px] uppercase tracking-[0.22em] text-arcane-400">
        Gruppenentscheidung
      </p>
      <h2 className="mt-1 font-serif text-base leading-relaxed text-parchment-100">
        {props.dialogue.prompt}
      </h2>
      <p className="mt-1 text-[10px] uppercase tracking-wider text-ink-200">
        Sprecher: {speaker?.name ?? "Unbekannt"} ·{" "}
        {props.dialogue.resolutionMode === "majority"
          ? "Mehrheit"
          : "Sprecher entscheidet"}
      </p>
      <div className="mt-3 space-y-1.5">
        {options.map((option) => {
          const votes = Object.values(props.dialogue.votes).filter(
            (vote) => vote.optionId === option.id,
          ).length;
          const selected = ownVote === option.id;
          return (
            <button
              key={option.id}
              type="button"
              disabled={Boolean(props.pending) || !props.actorId}
              onClick={() =>
                props.onCommand(
                  `dialogue-vote:${option.id}`,
                  {
                    type: "dialogue.vote",
                    decisionId: props.dialogue.id,
                    memberId: props.actorId,
                    optionId: option.id,
                  },
                  "Stimme abgegeben",
                )
              }
              className={cn(
                "grid min-h-12 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-sm border px-3 py-2 text-left transition",
                selected
                  ? "border-arcane-400/80 bg-arcane-500/25 text-parchment-100"
                  : "border-brass-700/35 bg-ink-600/65 text-ink-100 hover:border-arcane-400/60",
              )}
            >
              <span>
                <span className="block text-sm">{option.label}</span>
                {option.check ? (
                  <span className="mt-0.5 block font-display text-[9px] uppercase tracking-wider text-arcane-400">
                    {option.check.skill} · SG {option.check.dc}
                  </span>
                ) : null}
              </span>
              <span className="flex h-7 min-w-7 items-center justify-center rounded-sm border border-ink-200/20 bg-ink-700/75 px-1.5 font-display text-[9px]">
                {votes}
              </span>
            </button>
          );
        })}
      </div>
      {actorIsSpeaker && selectedOption?.check ? (
        <div className="mt-3 rounded-sm border border-arcane-400/35 bg-ink-700/55 p-2.5">
          <p className="font-display text-[9px] uppercase tracking-[0.16em] text-arcane-400">
            Wer führt die Probe aus?
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {eligibleCheckers.map((member) => (
              <button
                key={member.id}
                type="button"
                disabled={Boolean(props.pending)}
                onClick={() =>
                  props.onCommand(
                    `dialogue-checker:${selectedOption.id}:${member.id}`,
                    {
                      type: "dialogue.delegateCheck",
                      decisionId: props.dialogue.id,
                      optionId: selectedOption.id,
                      delegatorId: props.actorId,
                      memberId: member.id,
                    },
                    `${member.name} übernimmt die Probe`,
                  )
                }
                className={cn(
                  "min-h-9 rounded-sm border px-2.5 py-1.5 text-xs",
                  checkerId === member.id
                    ? "border-arcane-400/75 bg-arcane-500/25 text-parchment-100"
                    : "border-ink-200/20 bg-ink-600/65 text-ink-100",
                )}
              >
                {member.name}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {canAssist && selectedOption?.check ? (
        <button
          type="button"
          disabled={Boolean(props.pending)}
          onClick={() =>
            props.onCommand(
              `dialogue-assist:${selectedOption.id}:${props.actorId}`,
              {
                type: "dialogue.assist",
                decisionId: props.dialogue.id,
                optionId: selectedOption.id,
                memberId: props.actorId,
                enabled: !actorAssisting,
              },
              actorAssisting ? "Hilfe zurückgezogen" : "Hilfe zugesagt",
            )
          }
          className="mt-2 min-h-9 w-full rounded-sm border border-arcane-400/45 bg-ink-600/60 px-3 py-2 text-xs text-ink-100 hover:border-arcane-400/70"
        >
          {actorAssisting ? "Hilfe zurückziehen" : "Bei der Probe helfen"}
        </button>
      ) : null}
      {actorIsSpeaker && ownVote ? (
        <button
          type="button"
          disabled={
            Boolean(props.pending) ||
            (Boolean(selectedOption?.check) && !checkerReady)
          }
          onClick={() =>
            props.onCommand(
              `dialogue-resolve:${props.dialogue.id}`,
              {
                type: selectedOption?.check
                  ? "dialogue.rollAndResolve"
                  : "dialogue.resolve",
                decisionId: props.dialogue.id,
                memberId: props.actorId,
                optionId: ownVote,
              },
              "Entscheidung bestätigt",
            )
          }
          className="mt-3 min-h-10 w-full rounded-sm border border-arcane-400/65 bg-arcane-600/30 px-3 py-2 font-display text-[9px] uppercase tracking-[0.16em] text-parchment-100 hover:bg-arcane-500/35 disabled:cursor-not-allowed disabled:opacity-45"
        >
          {selectedOption?.check
            ? `${selectedOption.check.skill} würfeln & entscheiden`
            : "Entscheidung bestätigen"}
        </button>
      ) : null}
    </section>
  );
}

function RestPanel(props: {
  role: "host" | "player";
  actorId: string;
  members: PartyMember[];
  resources: Record<string, PartyResource>;
  rest: RestProposal | null;
  pending: string | null;
  onCommand: (
    key: string,
    command: Record<string, unknown>,
    successMessage?: string,
  ) => Promise<boolean>;
}) {
  const resources = Object.values(props.resources);
  const rest = props.rest;
  const votesFor = rest
    ? Object.values(rest.votes).filter((vote) => vote).length
    : 0;
  const ownVote = rest?.votes[props.actorId];
  return (
    <section>
      <SectionHeading
        eyebrow="Lager"
        title="Ressourcen und Rast"
        meta={
          rest
            ? `${votesFor}/${rest.eligibleMemberIds.length} stimmen zu`
            : "Gemeinsam abstimmen"
        }
      />
      <div className="mb-3 grid grid-cols-2 gap-1.5">
        {resources.map((resource) => (
          <div
            key={resource.id}
            className="rounded-sm border border-brass-700/35 bg-ink-600/60 px-2.5 py-2"
          >
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="truncate text-ink-100">{resource.label}</span>
              <span className="font-display text-[10px] text-parchment-100">
                {resource.current}/{resource.max}
              </span>
            </div>
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-ink-800">
              <div
                className="h-full bg-brass-400"
                style={{
                  width: `${resource.max > 0 ? Math.round((resource.current / resource.max) * 100) : 0}%`,
                }}
              />
            </div>
          </div>
        ))}
      </div>

      {!rest ? (
        <div className="grid grid-cols-2 gap-2">
          <RestButton
            label="Kurze Rast"
            detail="Kurze Ressourcen"
            disabled={Boolean(props.pending) || !props.actorId}
            onClick={() =>
              props.onCommand(
                "rest:short",
                {
                  type: "rest.propose",
                  proposalId: `rest-${requestId()}`,
                  restType: "short",
                  proposerId: props.actorId,
                  eligibleMemberIds: props.members
                    .filter((member) => member.active)
                    .map((member) => member.id),
                  policy: "majority",
                },
                "Kurze Rast vorgeschlagen",
              )
            }
          />
          <RestButton
            label="Lange Rast"
            detail="Alle Ressourcen"
            disabled={Boolean(props.pending) || !props.actorId}
            onClick={() =>
              props.onCommand(
                "rest:long",
                {
                  type: "rest.propose",
                  proposalId: `rest-${requestId()}`,
                  restType: "long",
                  proposerId: props.actorId,
                  eligibleMemberIds: props.members
                    .filter((member) => member.active)
                    .map((member) => member.id),
                  policy: "majority",
                },
                "Lange Rast vorgeschlagen",
              )
            }
          />
        </div>
      ) : (
        <div className="rounded-sm border border-brass-600/50 bg-brass-900/35 p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-display text-[9px] uppercase tracking-[0.18em] text-brass-400">
                {rest.type === "long" ? "Lange Rast" : "Kurze Rast"}
              </p>
              <p className="mt-1 text-sm text-parchment-100">
                {rest.status === "accepted"
                  ? "Die Gruppe ist bereit."
                  : "Die Gruppe stimmt ab."}
              </p>
            </div>
            <span className="font-display text-xs text-brass-300">
              {votesFor}/{rest.eligibleMemberIds.length}
            </span>
          </div>
          {rest.status === "proposed" ? (
            <div className="mt-3 grid grid-cols-2 gap-2">
              <VoteButton
                label={ownVote === true ? "Zugestimmt" : "Zustimmen"}
                selected={ownVote === true}
                disabled={Boolean(props.pending)}
                onClick={() =>
                  props.onCommand(
                    `rest-vote:yes:${rest.id}`,
                    {
                      type: "rest.vote",
                      proposalId: rest.id,
                      memberId: props.actorId,
                      approve: true,
                    },
                    "Rast zugestimmt",
                  )
                }
              />
              <VoteButton
                label={ownVote === false ? "Abgelehnt" : "Ablehnen"}
                selected={ownVote === false}
                disabled={Boolean(props.pending)}
                onClick={() =>
                  props.onCommand(
                    `rest-vote:no:${rest.id}`,
                    {
                      type: "rest.vote",
                      proposalId: rest.id,
                      memberId: props.actorId,
                      approve: false,
                    },
                    "Rast abgelehnt",
                  )
                }
              />
            </div>
          ) : null}
          {rest.status === "accepted" && props.role === "host" ? (
            <button
              type="button"
              disabled={Boolean(props.pending)}
              onClick={() =>
                props.onCommand(
                  `rest-complete:${rest.id}`,
                  { type: "rest.complete", proposalId: rest.id },
                  "Rast abgeschlossen",
                )
              }
              className="mt-3 min-h-10 w-full rounded-sm border border-brass-400/70 bg-brass-700/40 px-3 py-2 font-display text-[9px] uppercase tracking-[0.16em] text-parchment-100 hover:bg-brass-600/45 disabled:opacity-45"
            >
              Rast beginnen
            </button>
          ) : null}
          {rest.status === "accepted" && props.role !== "host" ? (
            <p className="mt-3 text-xs text-ink-100">
              Die Spielleitung kann die Rast jetzt beginnen.
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}

function RestButton(props: {
  label: string;
  detail: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={props.disabled}
      onClick={props.onClick}
      className="min-h-16 rounded-sm border border-brass-600/50 bg-[linear-gradient(145deg,rgba(90,64,23,0.28),rgba(14,13,10,0.82))] px-3 py-2 text-left hover:border-brass-400/70 disabled:cursor-not-allowed disabled:opacity-45"
    >
      <span className="block font-display text-[10px] uppercase tracking-wider text-parchment-100">
        {props.label}
      </span>
      <span className="mt-1 block text-[10px] text-ink-200">
        {props.detail}
      </span>
    </button>
  );
}

function VoteButton(props: {
  label: string;
  selected: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={props.disabled}
      onClick={props.onClick}
      className={cn(
        "min-h-10 rounded-sm border px-3 py-2 font-display text-[9px] uppercase tracking-wider",
        props.selected
          ? "border-brass-300/80 bg-brass-600/45 text-parchment-100"
          : "border-brass-700/45 bg-ink-600/65 text-ink-100 hover:border-brass-400/60",
      )}
    >
      {props.label}
    </button>
  );
}

function ReactionPrompt(props: {
  reaction: ReactionView;
  abilities: AbilityDefinition[];
  disabled: boolean;
  onRespond: (choice: string, automatic: boolean) => Promise<boolean>;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [duration, setDuration] = useState(() =>
    Math.max(1, props.reaction.expiresAt - Date.now()),
  );
  const automaticRef = useRef<string | null>(null);
  const seconds = reactionSecondsRemaining(props.reaction.expiresAt, now);

  useEffect(() => {
    const startedAt = Date.now();
    setNow(startedAt);
    setDuration(Math.max(1, props.reaction.expiresAt - startedAt));
    automaticRef.current = null;
    const interval = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(interval);
  }, [props.reaction.expiresAt, props.reaction.id]);

  useEffect(() => {
    if (seconds > 0 || automaticRef.current === props.reaction.id) return;
    automaticRef.current = props.reaction.id;
    void props.onRespond("pass", true);
  }, [props, seconds]);

  const options = props.reaction.options.filter((option) => option !== "pass");
  return (
    <aside
      role="dialog"
      aria-modal="true"
      aria-labelledby="reaction-title"
      className="relative z-20 shrink-0 overflow-hidden border-b border-arcane-400/55 bg-[linear-gradient(110deg,rgba(74,50,121,0.72),rgba(8,7,5,0.98)_68%)] px-3 py-3 shadow-[0_14px_40px_rgba(0,0,0,0.55)] sm:px-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-display text-[9px] uppercase tracking-[0.24em] text-arcane-400">
            Reaktionsfenster
          </p>
          <h2
            id="reaction-title"
            className="mt-0.5 font-display text-base text-parchment-100"
          >
            Jetzt reagieren
          </h2>
          <p className="mt-1 text-xs text-ink-100">
            {reactionTriggerLabel(props.reaction.trigger)}
          </p>
        </div>
        <div className="flex h-10 min-w-10 items-center justify-center rounded-sm border border-arcane-400/60 bg-ink-700/75 font-display text-sm text-parchment-100">
          {seconds}
        </div>
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-ink-800">
        <div
          className="h-full origin-left bg-arcane-400 transition-[width] duration-200"
          style={{
            width: `${Math.max(0, Math.min(100, ((props.reaction.expiresAt - now) / duration) * 100))}%`,
          }}
        />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {options.map((option) => {
          const ability = props.abilities.find((entry) => entry.id === option);
          return (
            <button
              key={option}
              type="button"
              disabled={props.disabled || seconds <= 0}
              onClick={() => props.onRespond(option, false)}
              className="min-h-11 rounded-sm border border-arcane-400/60 bg-arcane-600/30 px-3 py-2 font-display text-[9px] uppercase tracking-wider text-parchment-100 hover:bg-arcane-500/40 disabled:opacity-45"
            >
              {ability?.name ?? humanizeId(option)}
            </button>
          );
        })}
        <button
          type="button"
          disabled={props.disabled || seconds <= 0}
          onClick={() => props.onRespond("pass", false)}
          className="min-h-11 rounded-sm border border-ink-200/30 bg-ink-600/75 px-3 py-2 font-display text-[9px] uppercase tracking-wider text-ink-100 hover:border-brass-400/55 disabled:opacity-45"
        >
          Passieren
        </button>
      </div>
    </aside>
  );
}

function SectionHeading(props: {
  eyebrow: string;
  title: string;
  meta?: string;
}) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <div className="min-w-0">
        <p className="font-display text-[9px] uppercase tracking-[0.24em] text-brass-400">
          {props.eyebrow}
        </p>
        <h2 className="truncate font-display text-lg text-parchment-100">
          {props.title}
        </h2>
      </div>
      {props.meta ? (
        <p className="max-w-[44%] text-right text-[10px] leading-snug text-ink-200">
          {props.meta}
        </p>
      ) : null}
    </div>
  );
}

function Subheading(props: { title: string; count: number }) {
  return (
    <div className="mb-2 mt-5 flex items-center gap-2">
      <h2 className="font-display text-[10px] uppercase tracking-[0.2em] text-brass-400">
        {props.title}
      </h2>
      <span className="rounded-sm border border-brass-700/40 px-1.5 py-0.5 font-display text-[8px] text-ink-100">
        {props.count}
      </span>
      <span className="h-px flex-1 bg-gradient-to-r from-brass-700/45 to-transparent" />
    </div>
  );
}

function EmptyState(props: { title: string; text: string }) {
  return (
    <div className="rounded-sm border border-dashed border-brass-700/40 bg-ink-600/35 px-4 py-6 text-center">
      <p className="font-display text-[10px] uppercase tracking-wider text-brass-400">
        {props.title}
      </p>
      <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-ink-100">
        {props.text}
      </p>
    </div>
  );
}

function ConsoleLoading() {
  return (
    <div role="status" className="space-y-2 py-2">
      <span className="sr-only">Gameplay-Konsole wird geladen</span>
      {[0, 1, 2].map((index) => (
        <div
          key={index}
          className="h-14 animate-pulse rounded-sm border border-brass-700/25 bg-ink-600/55 motion-reduce:animate-none"
        />
      ))}
    </div>
  );
}

function ConsoleEmpty(props: { onRetry: () => void }) {
  return (
    <div className="py-3 text-center">
      <EmptyState
        title="Konsole nicht verbunden"
        text="Die Gameplay-Daten konnten noch nicht geladen werden."
      />
      <button
        type="button"
        onClick={props.onRetry}
        className="mt-3 min-h-10 rounded-sm border border-brass-600/55 bg-brass-800/40 px-4 py-2 font-display text-[9px] uppercase tracking-wider text-brass-300"
      >
        Erneut laden
      </button>
    </div>
  );
}

export function gameplayStateUrl(sessionId: string, inviteToken?: string) {
  return inviteToken
    ? `/api/invite/sessions/${encodeURIComponent(sessionId)}/gameplay/${encodeURIComponent(inviteToken)}`
    : `/api/sessions/${encodeURIComponent(sessionId)}/gameplay`;
}

export function combatActionUrl(sessionId: string, inviteToken?: string) {
  return inviteToken
    ? `/api/invite/sessions/${encodeURIComponent(sessionId)}/combat-action/${encodeURIComponent(inviteToken)}`
    : `/api/sessions/${encodeURIComponent(sessionId)}/combat-action`;
}

export function dmTurnUrl(sessionId: string, inviteToken?: string) {
  return inviteToken
    ? `/api/invite/sessions/${encodeURIComponent(sessionId)}/turn/${encodeURIComponent(inviteToken)}`
    : `/api/sessions/${encodeURIComponent(sessionId)}/turn`;
}

export function dmRollUrl(sessionId: string, inviteToken?: string) {
  return inviteToken
    ? `/api/invite/sessions/${encodeURIComponent(sessionId)}/roll/${encodeURIComponent(inviteToken)}`
    : `/api/sessions/${encodeURIComponent(sessionId)}/roll`;
}

export function queuedTurnLabel(position: unknown) {
  const safePosition =
    typeof position === "number" && Number.isFinite(position)
      ? Math.max(1, Math.floor(position))
      : 1;
  return `Aktion vorgemerkt · Position ${safePosition} in der Tischrunde`;
}

export function reactionSecondsRemaining(expiresAt: number, now: number) {
  if (!Number.isFinite(expiresAt) || !Number.isFinite(now)) return 0;
  return Math.max(0, Math.ceil((expiresAt - now) / 1000));
}

export function abilityActionMode(input: {
  combatActive: boolean;
  canAct: boolean;
  completed: boolean;
}): "use_ability" | "plan_action" | "blocked" {
  if (!input.combatActive || input.completed) return "blocked";
  return input.canAct ? "use_ability" : "plan_action";
}

export function resourceIdForAbilityCost(resourceId: string) {
  const spellSlot = resourceId.match(
    /^spell\s*[-_:]?\s*slot\s*[-_:]?\s*(\d+)$/i,
  );
  if (spellSlot) return `spell-slot-${spellSlot[1]}`;
  const compactSlot = resourceId.match(/^spellSlot:(\d+)$/i);
  if (compactSlot) return `spell-slot-${compactSlot[1]}`;
  return resourceId
    .trim()
    .toLowerCase()
    .replace(/[_:\s]+/g, "-");
}

export function validTargetForAbility(
  ability: AbilityDefinition,
  actor: Pick<Token, "id" | "team" | "hp">,
  selected:
    | (Pick<Token, "id" | "team" | "hp"> &
        Partial<Pick<Token, "statuses">>)
    | null,
) {
  if (ability.target.minTargets === 0 || ability.target.kind === "none") {
    return true;
  }
  if (ability.target.kind === "self") return true;
  if (!selected) return false;
  const dead = selected.statuses?.some(
    (status) => status.condition.toLowerCase() === "dead",
  );
  if (dead && !ability.target.allowDead) return false;
  if (!dead && selected.hp <= 0 && !ability.target.allowDowned) return false;
  if (ability.target.kind === "enemy") return selected.team !== actor.team;
  if (ability.target.kind === "ally") {
    return (
      selected.team === actor.team &&
      (ability.target.includeSelf || selected.id !== actor.id)
    );
  }
  if (!ability.target.includeSelf && selected.id === actor.id) return false;
  return true;
}

export function isVisibleCombatTarget(input: {
  actor: Pick<Token, "id" | "team">;
  candidate: Pick<Token, "id" | "team" | "hp">;
  hiddenTokenIds: string[];
  host: boolean;
}) {
  if (input.candidate.id === input.actor.id) return false;
  const hostile = input.candidate.team !== input.actor.team;
  if (hostile && input.candidate.hp <= 0) return false;
  if (
    hostile &&
    !input.host &&
    input.hiddenTokenIds.includes(input.candidate.id)
  ) {
    return false;
  }
  // Downed allies remain targetable so Stabilisieren and revival abilities
  // can select them; each ability still validates allowDowned separately.
  return true;
}

export function questProgress(quest: StructuredQuest) {
  const objectives = quest.objectiveOrder
    .map((id) => quest.objectives[id])
    .filter(Boolean);
  const total = objectives.length;
  const completed = objectives.filter(
    (objective) => objective.status === "completed",
  ).length;
  return {
    total,
    completed,
    percent: total > 0 ? Math.round((completed / total) * 100) : 0,
  };
}

export function consoleErrorLabel(
  error: unknown,
  status: number,
  message?: unknown,
) {
  if (typeof message === "string" && message.trim()) return message.trim();
  if (error === "dm_busy") {
    return "Der Codex-DM verarbeitet gerade eine andere Aktion.";
  }
  if (error === "turn_queue_actor_limit") {
    return "Du hast bereits drei Aktionen vorgemerkt.";
  }
  if (error === "turn_queue_full") {
    return "Die Tischrunde ist gerade voll. Versuche es gleich erneut.";
  }
  if (error === "turn_queue_unavailable") {
    return "Die Aktionswarteschlange ist kurz nicht erreichbar.";
  }
  if (error === "not_your_turn") return "Deine Figur ist noch nicht am Zug.";
  if (error === "target_required") return "Wähle zuerst ein gültiges Ziel.";
  if (error === "target_out_of_range") return "Das Ziel ist außer Reichweite.";
  if (error === "insufficient_resource") return "Dafür fehlt eine Ressource.";
  if (error === "action_spent") return "Die Aktion ist bereits verbraucht.";
  if (error === "reaction_expired")
    return "Das Reaktionsfenster ist abgelaufen.";
  if (error === "forbidden")
    return "Diese Figur darf den Befehl nicht ausführen.";
  if (error === "session_closed") return "Die Session ist bereits beendet.";
  if (typeof error === "string" && error.trim()) {
    return humanizeId(error);
  }
  return `Befehl fehlgeschlagen (${status})`;
}

function actorTokenFor(
  actor: GameplayCharacter,
  tokens: Record<string, Token>,
) {
  return (
    tokens[actor.id] ??
    Object.values(tokens).find(
      (token) =>
        token.name.trim().toLowerCase() === actor.name.trim().toLowerCase(),
    ) ??
    null
  );
}

function targetIdForAbility(
  ability: AbilityDefinition,
  actor: Token,
  selected: Token | null,
) {
  if (ability.target.kind === "self") return actor.id;
  if (ability.target.minTargets === 0 || ability.target.kind === "none") {
    return undefined;
  }
  return selected?.id;
}

function abilityEconomyAvailable(
  ability: AbilityDefinition,
  combat: typeof EMPTY_COMBAT_RESOURCES,
  resources: Record<string, PartyResource>,
) {
  if (ability.cost.action && combat.actionUsed) return false;
  if (ability.cost.bonusAction && combat.bonusActionUsed) return false;
  if (ability.cost.reaction && combat.reactionUsed) return false;
  return Object.entries(ability.cost.resources ?? {}).every(
    ([resourceId, amount]) =>
      (resources[resourceIdForAbilityCost(resourceId)]?.current ?? 0) >= amount,
  );
}

function abilitySummary(ability: AbilityDefinition) {
  const effect = ability.effects[0];
  const range =
    ability.target.range > 0 ? ` · ${ability.target.range} Felder` : "";
  if (!effect) return `${targetKindLabel(ability.target.kind)}${range}`;
  if (effect.kind === "attack")
    return `${effect.damage} ${humanizeId(effect.damageType)}${range}`;
  if (effect.kind === "save") return `Rettungswurf SG ${effect.dc}${range}`;
  if (effect.kind === "heal") return `${effect.amount} Heilung${range}`;
  if (effect.kind === "damage")
    return `${effect.amount} ${humanizeId(effect.damageType)}${range}`;
  if (effect.kind === "status") return `${humanizeId(effect.status)}${range}`;
  if (effect.kind === "stabilize") return `Stabilisieren${range}`;
  if (effect.kind === "revive")
    return `Wiederbeleben · ${effect.hitPoints} TP${range}`;
  return `${targetKindLabel(ability.target.kind)}${range}`;
}

function activationLabel(value: AbilityDefinition["activation"]) {
  if (value === "bonusAction") return "Bonus";
  if (value === "reaction") return "Reaktion";
  if (value === "free") return "Frei";
  if (value === "passive") return "Passiv";
  return "Aktion";
}

function targetKindLabel(value: AbilityDefinition["target"]["kind"]) {
  if (value === "self") return "Selbst";
  if (value === "ally") return "Verbündeter";
  if (value === "enemy") return "Gegner";
  if (value === "creature") return "Kreatur";
  return "Ohne Ziel";
}

function dialogueOptions(dialogue: DialogueView) {
  return dialogue.optionOrder
    .map((id) => dialogue.options[id])
    .filter((option): option is DialogueOption => Boolean(option));
}

function questStatusRank(status: StructuredQuest["status"]) {
  if (status === "active") return 0;
  if (status === "inactive") return 1;
  if (status === "completed") return 2;
  return 3;
}

function questStatusLabel(status: StructuredQuest["status"]) {
  if (status === "active") return "Aktiv";
  if (status === "inactive") return "Noch verborgen";
  if (status === "completed") return "Abgeschlossen";
  return "Gescheitert";
}

function slotLabel(slot: string) {
  const labels: Record<string, string> = {
    head: "Kopf",
    armor: "Rüstung",
    "main-hand": "Haupthand",
    "off-hand": "Nebenhand",
    "ring-1": "Ring I",
    "ring-2": "Ring II",
  };
  return labels[slot] ?? humanizeId(slot);
}

function environmentActionLabel(action: string) {
  const labels: Record<string, string> = {
    open: "Öffnen",
    close: "Schließen",
    disarm: "Entschärfen",
    ignite: "Entzünden",
    damage: "Zerstören",
  };
  return labels[action] ?? "Benutzen";
}

function reactionTriggerLabel(trigger: string) {
  if (trigger === "attack" || trigger === "targeted_by_attack") {
    return "Ein Angriff zielt auf deine Figur.";
  }
  if (trigger === "movement" || trigger === "leaves_reach") {
    return "Eine Bewegung löst eine Reaktion aus.";
  }
  if (trigger === "spell" || trigger === "spell_cast") {
    return "Ein Zauber löst eine Reaktion aus.";
  }
  return "Ein Ereignis erlaubt eine sofortige Reaktion.";
}

function shortTime(timestamp: number) {
  return new Intl.DateTimeFormat("de-CH", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function humanizeId(value: string) {
  const label = value
    .replace(/^(core|spell|feature):/i, "")
    .replace(/[-_.:]+/g, " ")
    .trim();
  if (!label) return "Unbekannt";
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function requestId() {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}
