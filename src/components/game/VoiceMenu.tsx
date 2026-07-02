"use client";

import type { RefObject } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useGame } from "@/lib/game/store";
import { cn } from "@/lib/cn";

type Voice = {
  voiceId: string;
  name: string;
  language: string | null;
  source: "clone";
};

type Assignment = {
  id?: string;
  targetType: "narrator" | "npc" | "character";
  targetId: string;
  voiceId: string;
  voiceName: string;
  voiceSource?: string;
  updatedAt?: string;
};

type VoiceRouteInput = {
  campaignId: string;
  sessionId: string;
  inviteToken?: string;
};

type VoiceTarget = {
  targetType: "narrator" | "npc" | "character";
  targetId: string;
  label: string;
};

function voicesPath(input: VoiceRouteInput) {
  return input.inviteToken
    ? `/api/invite/sessions/${encodeURIComponent(input.sessionId)}/voices/${encodeURIComponent(
        input.inviteToken,
      )}`
    : `/api/campaigns/${encodeURIComponent(
        input.campaignId,
      )}/voices?sessionId=${encodeURIComponent(input.sessionId)}`;
}

function assignmentsPath(input: VoiceRouteInput) {
  return input.inviteToken
    ? `/api/invite/sessions/${encodeURIComponent(
        input.sessionId,
      )}/voice-assignments/${encodeURIComponent(input.inviteToken)}`
    : `/api/campaigns/${encodeURIComponent(
        input.campaignId,
      )}/voice-assignments?sessionId=${encodeURIComponent(input.sessionId)}`;
}

export function VoiceMenu(props: {
  campaignId: string;
  sessionId: string;
  inviteToken?: string;
  role: "host" | "player";
  localCharacters: Array<{ id: string; name: string }>;
  triggerRef?: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}) {
  const {
    campaignId,
    sessionId,
    inviteToken,
    role,
    localCharacters,
    triggerRef,
    onClose,
  } = props;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const presentNpcs = useGame((state) => state.scene.presentNpcs ?? []);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sections = useMemo(() => {
    const narratorTargets: VoiceTarget[] =
      role === "host"
        ? [
            {
              targetType: "narrator",
              targetId: "narrator",
              label: "Erzähler",
            },
          ]
        : [];
    const characterTargets = localCharacters.map((character) => ({
      targetType: "character" as const,
      targetId: character.id,
      label: character.name,
    }));
    const npcTargets =
      role === "host"
        ? Array.from(
            new Map(
              presentNpcs.map((npc) => [
                npc.id,
                {
                  targetType: "npc" as const,
                  targetId: npc.id,
                  label: npc.name,
                },
              ]),
            ).values(),
          )
        : [];

    return [
      narratorTargets.length > 0
        ? { title: "Erzähler", targets: narratorTargets }
        : null,
      characterTargets.length > 0
        ? { title: "Figuren", targets: characterTargets }
        : null,
      npcTargets.length > 0 ? { title: "Anwesende NSC", targets: npcTargets } : null,
    ].filter(
      (
        section,
      ): section is {
        title: string;
        targets: VoiceTarget[];
      } => section !== null,
    );
  }, [localCharacters, presentNpcs, role]);

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      const root = rootRef.current;
      if (!root) return;
      const trigger = triggerRef?.current;
      const target = event.target;
      const isInsideMenu = target instanceof Node && root.contains(target);
      const isInsideTrigger =
        target instanceof Node && trigger instanceof HTMLElement && trigger.contains(target);

      if (!isInsideMenu && !isInsideTrigger) {
        onClose();
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose, triggerRef]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setError(null);

      const [voiceResponse, assignmentResponse] = await Promise.all([
        fetch(voicesPath({ campaignId, sessionId, inviteToken })),
        fetch(assignmentsPath({ campaignId, sessionId, inviteToken })),
      ]);

      if (!voiceResponse.ok || !assignmentResponse.ok) {
        throw new Error("load_failed");
      }

      const voiceBody = (await voiceResponse.json()) as { voices: Voice[] };
      const assignmentBody = (await assignmentResponse.json()) as {
        assignments: Assignment[];
      };

      if (cancelled) return;
      setVoices(voiceBody.voices);
      setAssignments(assignmentBody.assignments);
      setIsLoading(false);
    }

    load().catch(() => {
      if (cancelled) return;
      setError("Stimmen konnten nicht geladen werden.");
      setIsLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [campaignId, inviteToken, sessionId]);

  async function saveAssignment(target: VoiceTarget, voiceId: string) {
    if (!voiceId) return;

    const key = `${target.targetType}:${target.targetId}`;
    setSavingKey(key);
    setError(null);

    try {
      const response = await fetch(
        assignmentsPath({ campaignId, sessionId, inviteToken }),
        {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          assignments: [
            {
              targetType: target.targetType,
              targetId: target.targetId,
              voiceId,
            },
          ],
        }),
        },
      );

      if (!response.ok) {
        throw new Error("save_failed");
      }

      const body = (await response.json()) as { assignments: Assignment[] };

      setAssignments((current) => {
        const next = current.filter(
          (assignment) =>
            !body.assignments.some(
              (saved) =>
                saved.targetType === assignment.targetType &&
                saved.targetId === assignment.targetId,
            ),
        );
        return [...next, ...body.assignments];
      });
    } catch {
      setError("Stimme konnte nicht gespeichert werden.");
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="false"
      aria-label="Stimmen"
      className="absolute right-3 top-16 z-40 w-[min(26rem,calc(100%-1.5rem))] border border-brass-700/45 bg-ink-500/95 shadow-2xl"
    >
      <div className="flex items-center justify-between gap-3 border-b border-brass-700/45 px-4 py-3">
        <div className="min-w-0">
          <p className="font-display text-[10px] uppercase tracking-[0.24em] text-brass-400">
            Stimmen
          </p>
          <p className="truncate text-xs text-ink-100">
            Vocarium-Clone-Stimmen des Hosts
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-brass-700/45 bg-ink-600/70 px-3 py-1.5 text-xs text-brass-300 hover:border-brass-400/70"
        >
          Schließen
        </button>
      </div>

      <div className="max-h-[min(32rem,70vh)] overflow-y-auto px-4 py-3">
        {error ? <p className="mb-3 text-sm text-blood-500">{error}</p> : null}

        {isLoading ? (
          <p className="text-sm text-ink-100">Stimmen werden geladen.</p>
        ) : sections.length === 0 ? (
          <p className="text-sm text-ink-100">
            Keine eigene Figur für Stimmen verfügbar.
          </p>
        ) : voices.length === 0 ? (
          <p className="text-sm text-ink-100">
            Für diese Runde sind noch keine Clone-Stimmen verfügbar.
          </p>
        ) : (
          <div className="space-y-4">
            {sections.map((section) => (
              <section key={section.title} className="space-y-2">
                <p className="font-display text-[10px] uppercase tracking-[0.2em] text-brass-300">
                  {section.title}
                </p>
                <div className="space-y-3">
                  {section.targets.map((target) => {
                    const key = `${target.targetType}:${target.targetId}`;
                    const assigned =
                      assignments.find(
                        (assignment) =>
                          assignment.targetType === target.targetType &&
                          assignment.targetId === target.targetId,
                      ) ?? null;
                    const assignedVoiceMissing =
                      assigned !== null &&
                      !voices.some((voice) => voice.voiceId === assigned.voiceId);

                    return (
                      <label key={key} className="block">
                        <span className="mb-1 block truncate text-sm text-parchment-100">
                          {target.label}
                        </span>
                        <select
                          disabled={savingKey === key}
                          value={assigned?.voiceId ?? ""}
                          onChange={(event) => {
                            const nextVoiceId = event.target.value;
                            if (!nextVoiceId) return;
                            void saveAssignment(target, nextVoiceId);
                          }}
                          className={cn(
                            "w-full rounded-md border border-brass-700/45 bg-ink-600 px-3 py-2 text-sm text-parchment-100 focus:border-brass-400/70 focus:outline-none",
                            savingKey === key && "opacity-70",
                          )}
                        >
                          <option value="" disabled>
                            Stimme wählen
                          </option>
                          {assignedVoiceMissing ? (
                            <option value={assigned.voiceId}>{assigned.voiceName}</option>
                          ) : null}
                          {voices.map((voice) => (
                            <option key={voice.voiceId} value={voice.voiceId}>
                              {voice.language
                                ? `${voice.name} (${voice.language})`
                                : voice.name}
                            </option>
                          ))}
                        </select>
                        <p className="mt-1 text-xs text-ink-200">
                          {savingKey === key
                            ? "Speichert ..."
                            : assigned?.voiceName ?? "Keine Stimme zugewiesen"}
                        </p>
                      </label>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
