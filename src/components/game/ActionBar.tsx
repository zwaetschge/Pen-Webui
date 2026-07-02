"use client";

import { useRef, useState, KeyboardEvent } from "react";
import { EMPTY_COMBAT_RESOURCES } from "@/lib/game/combat-resources";
import { tokenMovement } from "@/lib/game/movement";
import { useGame, type CombatState, type Token } from "@/lib/game/store";
import {
  activeInitiativeName,
  isActiveTurnForCharacter,
  isActiveTurnForToken,
} from "@/lib/game/combat-turn";
import { cn } from "@/lib/cn";

type Props = {
  sessionId: string;
  inviteToken?: string;
  role: "host" | "player";
  localCharacters?: Array<{ id: string; name: string }>;
  selectedTokenId?: string | null;
  onSelectedTokenChange?: (tokenId: string | null) => void;
};

const QUICK_ROLLS = [
  { label: "W20", n: "1d20" },
  { label: "Vorteil", n: "1d20adv" },
  { label: "Nachteil", n: "1d20dis" },
  { label: "W6", n: "1d6" },
  { label: "W8", n: "1d8" },
  { label: "W10", n: "1d10" },
  { label: "W12", n: "1d12" },
];

export type CombatActionButtonType =
  | "attack"
  | "bonus_action"
  | "reaction"
  | "dash"
  | "dodge"
  | "disengage"
  | "end_turn";

export const COMBAT_ACTION_BUTTONS: Array<{
  type: CombatActionButtonType;
  label: string;
}> = [
  { type: "attack", label: "Angriff" },
  { type: "bonus_action", label: "Bonus" },
  { type: "reaction", label: "Reaktion" },
  { type: "dash", label: "Sprint" },
  { type: "dodge", label: "Ausw." },
  { type: "disengage", label: "Lösen" },
  { type: "end_turn", label: "Ende" },
];

const EMPTY_NEXT_ACTIONS: string[] = [];

export function selectNextActions(state: {
  scene: { nextActions?: string[] };
}) {
  return state.scene.nextActions ?? EMPTY_NEXT_ACTIONS;
}

export function selectActionCards(state: { scene: { nextActions?: string[] } }) {
  return selectNextActions(state)
    .slice(0, 3)
    .map((label, index) => ({
      id: `action-${index + 1}`,
      label,
      shortcut: String(index + 1),
    }));
}

export function actionChoiceGridClassName(actionCount: number) {
  return cn(
    "action-choice-grid grid gap-2",
    actionCount >= 3
      ? "grid-cols-1 md:grid-cols-3"
      : actionCount === 2
        ? "grid-cols-1 sm:grid-cols-2"
        : "grid-cols-1",
  );
}

export function actionChoiceButtonClassName() {
  return cn(
    "action-card action-card-play group relative flex w-full min-h-[4.75rem] items-start gap-3 overflow-hidden rounded-md border border-brass-700/50",
    "bg-ink-600/70 px-3 py-3 text-left text-sm leading-snug text-parchment-100 shadow-lg transition",
    "whitespace-normal break-words hover:-translate-y-0.5 hover:border-brass-400/75 hover:bg-ink-500/80 hover:shadow-brass",
    "focus-visible:border-brass-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass-400/35",
    "disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none",
  );
}

export function combatActionGridClassName() {
  return "grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7";
}

export function ActionBar(props: Props) {
  const localCharacters = props.localCharacters ?? [];
  const [selectedCharacterId, setSelectedCharacterId] = useState(
    localCharacters[0]?.id ?? "",
  );
  const [draft, setDraft] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const awaiting = useGame((s) => s.awaitingSkillCheck);
  const dmThinking = useGame((s) => s.dmThinking);
  const combat = useGame((s) => s.combat);
  const sessionEnded = useGame((s) => s.sessionEnded);
  const gameOver = useGame((s) => s.gameOver);
  const nextActions = useGame(selectNextActions);
  const actionCards = selectActionCards({ scene: { nextActions } });

  const selectedCharacter =
    localCharacters.find((c) => c.id === selectedCharacterId) ?? null;
  const blockedByTurn = Boolean(
    selectedCharacter &&
    combat.active &&
    !isActiveTurnForCharacter({
      initiative: combat.initiative,
      turnIndex: combat.turnIndex,
      characterId: selectedCharacter.id,
      characterName: selectedCharacter.name,
    }),
  );
  const busyOrBlocked = busy || dmThinking || blockedByTurn || sessionEnded;
  const activeTurnName = activeInitiativeName(
    combat.initiative,
    combat.turnIndex,
  );
  const inviteTokenPath = props.inviteToken
    ? encodeURIComponent(props.inviteToken)
    : null;
  const turnUrl = inviteTokenPath
    ? `/api/invite/sessions/${props.sessionId}/turn/${inviteTokenPath}`
    : `/api/sessions/${props.sessionId}/turn`;
  const rollUrl = inviteTokenPath
    ? `/api/invite/sessions/${props.sessionId}/roll/${inviteTokenPath}`
    : `/api/sessions/${props.sessionId}/roll`;

  if (sessionEnded) {
    return <EndedActionPanel title={gameOver?.title ?? "Session beendet"} />;
  }

  if (combat.active) {
    return (
      <CombatActionPanel
        sessionId={props.sessionId}
        inviteTokenPath={inviteTokenPath}
        role={props.role}
        localCharacters={localCharacters}
        selectedTokenId={props.selectedTokenId ?? null}
        onSelectedTokenChange={props.onSelectedTokenChange}
        dmThinking={dmThinking}
      />
    );
  }

  async function send() {
    if (busyOrBlocked) return;
    const text = draft.trim();
    if (!text) return;
    setBusy(true);
    setError(null);
    setDraft("");
    try {
      const response = await fetch(turnUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text,
          characterId: selectedCharacter?.id,
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(
          body.error ?? `Senden fehlgeschlagen (${response.status})`,
        );
      }
    } catch (e) {
      setDraft(text);
      setError(e instanceof Error ? e.message : "Senden fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  }

  async function quickRoll(
    notation: string,
    reason?: string,
    characterId?: string,
  ) {
    if (busyOrBlocked) return;
    setBusy(true);
    setError(null);
    try {
      const rollCharacterId = characterId ?? selectedCharacter?.id;
      const response = await fetch(rollUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          notation,
          reason,
          characterId: rollCharacterId,
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(
          body.error ?? `Wurf fehlgeschlagen (${response.status})`,
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Wurf fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== "Enter" || e.shiftKey) return;
    e.preventDefault();
    if (busyOrBlocked) return;
    const text = draft.trim();
    if (text.startsWith("/r ")) {
      const notation = text.slice(3).trim();
      if (notation) {
        setDraft("");
        quickRoll(notation);
      }
      return;
    }
    send();
  }

  function chooseActionCard(label: string) {
    setDraft(label);
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  }

  return (
    <div className="command-tray max-h-[46dvh] shrink-0 overflow-y-auto border-t border-brass-700/45 bg-ink-500/84 px-3 py-3 shadow-2xl sm:px-4 lg:max-h-[36vh]">
      {awaiting ? (
        <div className="table-note mb-3 border border-arcane-500/50 bg-arcane-600/15 px-3 py-2 text-sm">
          <p className="text-arcane-400">
            DM fordert: <strong>{awaiting.skill}</strong> SG&nbsp;{awaiting.dc}
          </p>
          <button
            type="button"
            disabled={busyOrBlocked}
            onClick={() =>
              quickRoll(
                "1d20",
                `Probe: ${awaiting.skill}`,
                awaiting.characterId,
              )
            }
            className="mt-2 rounded-md border border-arcane-500/60 bg-arcane-600/30 px-3 py-1.5 text-sm text-parchment-100 hover:bg-arcane-500/40"
          >
            W20 würfeln
          </button>
        </div>
      ) : null}

      {dmThinking ? (
        <div className="table-note mb-3 border border-brass-400/40 bg-brass-700/20 px-3 py-2 text-sm text-brass-300">
          Der DM wertet die Szene aus...
        </div>
      ) : null}

      {blockedByTurn ? (
        <div className="table-note mb-3 border border-brass-700/40 bg-ink-600/55 px-3 py-2 text-sm text-ink-100">
          Am Zug: {activeTurnName ?? "andere Figur"}
        </div>
      ) : null}

      {props.role === "host" && localCharacters.length > 0 ? (
        <label className="mb-3 flex items-center gap-2 text-sm text-ink-100">
          <span className="font-display uppercase tracking-wider text-brass-400">
            Als Figur
          </span>
          <select
            value={selectedCharacterId}
            onChange={(e) => setSelectedCharacterId(e.target.value)}
            className="min-w-0 flex-1 rounded-md border border-brass-700/40 bg-ink-600/70 px-3 py-1.5 text-parchment-100 focus:border-brass-400/60 focus:outline-none"
          >
            <option value="">Tischhinweis</option>
            {localCharacters.map((character) => (
              <option key={character.id} value={character.id}>
                {character.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {actionCards.length > 0 ? (
        <div className="choice-dock mb-3 rounded-md border border-brass-700/45 bg-ink-600/42 p-2 shadow-[0_16px_40px_rgba(0,0,0,0.28)]">
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="font-display text-[11px] uppercase tracking-[0.22em] text-brass-400">
              Nächster Zug
            </p>
            <span className="hidden h-px flex-1 bg-gradient-to-r from-brass-700/50 to-transparent sm:block" />
          </div>
          <div className={actionChoiceGridClassName(actionCards.length)}>
            {actionCards.map((action) => (
              <button
                key={action.id}
                type="button"
                disabled={busyOrBlocked}
                aria-label={`Option ${action.shortcut}: ${action.label}`}
                title={action.label}
                onClick={() => chooseActionCard(action.label)}
                className={actionChoiceButtonClassName()}
              >
                <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded border border-brass-700/70 bg-ink-700/85 font-display text-[10px] text-brass-300 transition group-hover:border-brass-400/80 group-hover:text-brass-200">
                  {action.shortcut}
                </span>
                <span className="min-w-0 flex-1 text-balance">{action.label}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <details className="dice-pocket mb-3 rounded-md border border-brass-700/35 bg-ink-600/35">
        <summary className="cursor-pointer px-3 py-2 font-display text-[11px] uppercase tracking-[0.2em] text-brass-400">
          Würfel
        </summary>
        <div className="dice-rail flex flex-wrap gap-1.5 border-t border-brass-700/25 p-2">
          {QUICK_ROLLS.map((q) => (
            <button
              key={q.label}
              type="button"
              disabled={busyOrBlocked}
              onClick={() => quickRoll(q.n)}
              className="dice-button border border-brass-700/50 bg-ink-600/70 px-2.5 py-1.5 text-xs text-brass-300 hover:border-brass-400/70 disabled:opacity-50"
            >
              {q.label}
            </button>
          ))}
        </div>
      </details>

      <div className="turn-composer grid gap-2 rounded-md border border-brass-700/45 bg-ink-700/45 p-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-stretch">
        <textarea
          ref={textareaRef}
          rows={2}
          value={draft}
          disabled={busyOrBlocked}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={
            selectedCharacter
              ? `Was tut ${selectedCharacter.name}?`
              : props.role === "host"
                ? "Tischhinweis an den KI-DM"
                : "Beschreibe deine Aktion..."
          }
          className="speech-input min-h-16 w-full resize-none rounded-md border border-brass-700/50 bg-ink-600/75 px-4 py-3 text-base leading-relaxed text-parchment-100 placeholder:text-ink-200 focus:border-brass-400/70 focus:outline-none disabled:opacity-70"
        />
        <button
          type="button"
          disabled={busyOrBlocked || !draft.trim()}
          onClick={send}
          className={cn(
            "min-h-12 rounded-md border px-5 py-2 text-sm font-medium sm:min-w-36",
            !draft.trim() || busyOrBlocked
              ? "cursor-not-allowed border-ink-200/30 bg-ink-600/40 text-ink-200"
              : "border-brass-400/70 bg-brass-700/40 text-parchment-100 shadow-brass hover:bg-brass-600/45",
          )}
        >
          {busy ? "Sendet" : dmThinking ? "DM denkt" : "Aktion senden"}
        </button>
      </div>
      <p className="mt-1 text-xs text-ink-200">
        Enter sendet. Shift+Enter schreibt weiter.
      </p>
      {error ? <p className="mt-1 text-xs text-blood-500">{error}</p> : null}
    </div>
  );
}

function EndedActionPanel(props: { title: string }) {
  return (
    <div className="command-tray bg-ink-600/92 shrink-0 border-t border-brass-700/45 px-4 py-4">
      <p className="font-display text-[10px] uppercase tracking-[0.24em] text-blood-500">
        {props.title}
      </p>
      <p className="mt-1 text-sm text-ink-100">Diese Session ist beendet.</p>
    </div>
  );
}

function CombatActionPanel(props: {
  sessionId: string;
  inviteTokenPath: string | null;
  role: "host" | "player";
  localCharacters: Array<{ id: string; name: string }>;
  selectedTokenId: string | null;
  onSelectedTokenChange?: (tokenId: string | null) => void;
  dmThinking: boolean;
}) {
  const combat = useGame((s) => s.combat);
  const tokens = useGame((s) => s.tokens);
  const sessionEnded = useGame((s) => s.sessionEnded);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeToken = activeCombatToken(combat, tokens);
  const selectedToken = props.selectedTokenId
    ? (tokens[props.selectedTokenId] ?? null)
    : null;
  const targets = activeToken
    ? Object.values(tokens)
        .filter((token) => isTarget(activeToken, token))
        .sort((a, b) => distance(activeToken, a) - distance(activeToken, b))
    : [];
  const selectedTarget =
    activeToken && selectedToken && isTarget(activeToken, selectedToken)
      ? selectedToken
      : (targets[0] ?? null);
  const resources = activeToken
    ? (combat.resources?.[activeToken.id] ?? EMPTY_COMBAT_RESOURCES)
    : EMPTY_COMBAT_RESOURCES;
  const localCharacterIds = new Set(props.localCharacters.map((c) => c.id));
  const canAct = Boolean(
    activeToken &&
    !sessionEnded &&
    tokenHp(activeToken) > 0 &&
    (props.role === "host" || localCharacterIds.has(activeToken.id)),
  );
  const actionUrl = props.inviteTokenPath
    ? `/api/invite/sessions/${props.sessionId}/combat-action/${props.inviteTokenPath}`
    : `/api/sessions/${props.sessionId}/combat-action`;
  const movement = activeToken ? movementAllowance(activeToken, combat) : 0;
  const spent = activeToken
    ? Math.max(0, Math.floor(combat.movementSpent?.[activeToken.id] ?? 0))
    : 0;
  const remainingMovement = Math.max(0, movement - spent);
  const attackRange = Math.max(1, Math.floor(activeToken?.attackRange ?? 1));
  const targetInRange = Boolean(
    activeToken &&
    selectedTarget &&
    distance(activeToken, selectedTarget) <= attackRange,
  );

  async function postAction(
    type: CombatActionButtonType,
    targetTokenId?: string,
  ) {
    if (busy || !canAct || sessionEnded) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(actionUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type, targetTokenId, requestId: requestId() }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(labelError(body.error, response.status));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Aktion fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  }

  const activeName =
    activeToken?.name ??
    activeInitiativeName(combat.initiative, combat.turnIndex);
  const lastAction = combat.lastAction;

  return (
    <div className="command-tray bg-ink-600/92 shrink-0 border-t border-brass-700/45 px-4 py-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-display text-[10px] uppercase tracking-[0.26em] text-brass-400">
            Runde {combat.round ?? 1}
          </p>
          <p className="truncate font-display text-base text-parchment-100">
            {activeName ?? "Initiative"}
          </p>
        </div>
        <div className="grid grid-cols-3 gap-1.5 text-center font-display text-[10px] uppercase tracking-wider">
          <ResourcePip label="Aktion" spent={resources.actionUsed} />
          <ResourcePip label="Bonus" spent={resources.bonusActionUsed} />
          <ResourcePip label="Reaktion" spent={resources.reactionUsed} />
        </div>
      </div>

      <div className="table-note mb-3 grid grid-cols-[1fr_auto] items-center gap-3 border border-brass-700/35 bg-ink-500/55 px-3 py-2">
        <div className="min-w-0">
          <p className="font-display text-[10px] uppercase tracking-[0.22em] text-ink-200">
            Ziel
          </p>
          <p className="truncate text-sm text-parchment-100">
            {selectedTarget
              ? `${selectedTarget.name} · RK ${selectedTarget.ac}`
              : "Kein Ziel"}
          </p>
        </div>
        <div className="font-display text-xs text-brass-300">
          {remainingMovement}/{movement}
        </div>
      </div>

      {targets.length > 0 ? (
        <div className="mb-3 flex gap-1.5 overflow-x-auto pb-1">
          {targets.map((target) => {
            const active = target.id === selectedTarget?.id;
            return (
              <button
                key={target.id}
                type="button"
                onClick={() => props.onSelectedTokenChange?.(target.id)}
                className={cn(
                  "action-card min-w-[7.5rem] border px-2.5 py-1.5 text-left text-xs",
                  active
                    ? "border-brass-400/70 bg-brass-700/35 text-parchment-100"
                    : "border-brass-700/35 bg-ink-500/50 text-ink-100 hover:border-brass-400/60",
                )}
              >
                <span className="block truncate font-display uppercase tracking-wider">
                  {target.name}
                </span>
                <span className="text-ink-200">
                  {tokenHp(target)}/{target.maxHp || tokenHp(target)}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}

      <div className={combatActionGridClassName()}>
        {COMBAT_ACTION_BUTTONS.map((button) => (
          <CombatButton
            key={button.type}
            label={button.label}
            disabled={combatActionDisabled({
              type: button.type,
              busy,
              canAct,
              resources,
              selectedTarget: Boolean(selectedTarget),
              targetInRange,
            })}
            active={combatActionActive({
              type: button.type,
              resources,
              selectedTarget: Boolean(selectedTarget),
              targetInRange,
            })}
            onClick={() =>
              postAction(
                button.type,
                button.type === "attack" ? selectedTarget?.id : undefined,
              )
            }
          />
        ))}
      </div>

      <div className="mt-2 min-h-5 text-xs">
        {error ? (
          <p className="text-blood-500">{error}</p>
        ) : lastAction ? (
          <p className="truncate text-ink-200">
            {lastAction.hit
              ? `${lastAction.actorName} -> ${lastAction.targetName}: ${lastAction.damage} Schaden`
              : `${lastAction.actorName} -> ${lastAction.targetName}: verfehlt`}
          </p>
        ) : props.dmThinking ? (
          <p className="text-brass-300">DM denkt</p>
        ) : !canAct ? (
          <p className="text-ink-200">Am Zug: {activeName ?? "Gegner"}</p>
        ) : null}
      </div>
    </div>
  );
}

function ResourcePip(props: { label: string; spent: boolean }) {
  return (
    <div
      className={cn(
        "dice-button border px-2 py-1",
        props.spent
          ? "border-ink-200/25 bg-ink-500/45 text-ink-200"
          : "border-brass-400/55 bg-brass-700/30 text-brass-300",
      )}
    >
      {props.label}
    </div>
  );
}

function CombatButton(props: {
  label: string;
  disabled: boolean;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={props.disabled}
      onClick={props.onClick}
      className={cn(
        "min-h-14 rounded-md border px-1.5 py-2 font-display text-[10px] uppercase leading-tight tracking-[0.08em] transition",
        props.disabled
          ? "cursor-not-allowed border-ink-200/20 bg-ink-500/40 text-ink-200/70"
          : props.active
            ? "border-brass-300/80 bg-brass-600/35 text-parchment-100 shadow-brass"
            : "border-brass-700/45 bg-ink-500/60 text-brass-300 hover:border-brass-400/70 hover:bg-ink-400/50",
      )}
    >
      {props.label}
    </button>
  );
}

function combatActionDisabled(input: {
  type: CombatActionButtonType;
  busy: boolean;
  canAct: boolean;
  resources: typeof EMPTY_COMBAT_RESOURCES;
  selectedTarget: boolean;
  targetInRange: boolean;
}) {
  if (input.busy || !input.canAct) return true;
  if (input.type === "end_turn") return false;
  if (input.type === "bonus_action") return input.resources.bonusActionUsed;
  if (input.type === "reaction") return input.resources.reactionUsed;
  if (input.type === "attack") {
    return (
      input.resources.actionUsed ||
      !input.selectedTarget ||
      !input.targetInRange
    );
  }
  return input.resources.actionUsed;
}

function combatActionActive(input: {
  type: CombatActionButtonType;
  resources: typeof EMPTY_COMBAT_RESOURCES;
  selectedTarget: boolean;
  targetInRange: boolean;
}) {
  if (input.type === "dash") return input.resources.dash;
  if (input.type === "dodge") return input.resources.dodge;
  if (input.type === "disengage") return input.resources.disengage;
  if (input.type === "attack") {
    return Boolean(input.selectedTarget && input.targetInRange);
  }
  return false;
}

function activeCombatToken(combat: CombatState, tokens: Record<string, Token>) {
  return Object.values(tokens).find((token) =>
    isActiveTurnForToken({
      initiative: combat.initiative,
      turnIndex: combat.turnIndex,
      token,
    }),
  );
}

function isTarget(actor: Token, target: Token) {
  return (
    actor.id !== target.id && actor.team !== target.team && tokenHp(target) > 0
  );
}

function tokenHp(token: Token) {
  return Math.max(0, Math.floor(token.hp ?? 0));
}

function distance(a: Pick<Token, "x" | "y">, b: Pick<Token, "x" | "y">) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function movementAllowance(token: Token, combat: CombatState) {
  return (
    tokenMovement(token) +
    Math.max(0, Math.floor(combat.resources?.[token.id]?.movementBonus ?? 0))
  );
}

function labelError(error: unknown, status: number) {
  if (error === "target_out_of_range") return "Ziel außer Reichweite";
  if (error === "action_spent") return "Aktion verbraucht";
  if (error === "bonus_action_spent") return "Bonus verbraucht";
  if (error === "reaction_spent") return "Reaktion verbraucht";
  if (error === "not_your_turn") return "Nicht am Zug";
  if (error === "target_required") return "Ziel fehlt";
  if (error === "target_not_found") return "Ziel nicht verfügbar";
  return `Aktion fehlgeschlagen (${status})`;
}

function requestId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}
