"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { mod, SKILL_LIST } from "@/lib/character/defaults";
import { cn } from "@/lib/cn";

type Sheet = Record<string, unknown> & {
  level?: number;
  class?: string;
  race?: string;
  background?: string;
  alignment?: string;
  abilities?: Record<"str" | "dex" | "con" | "int" | "wis" | "cha", number>;
  hpMax?: number;
  hpCurrent?: number;
  hpTemp?: number;
  ac?: number;
  speed?: number;
  initiative?: number;
  skills?: Record<string, "proficient" | "expert" | "none">;
  savingThrows?: Record<string, boolean>;
  inventory?: Array<{ name: string; qty: number; notes?: string }>;
  spells?: Array<{ name: string; level: number; prepared: boolean }>;
  features?: Array<{ name: string; source: string; description: string }>;
  notes?: string;
  appearance?: string;
  backstory?: string;
  proficiencyBonus?: number;
};

type Props = {
  characterId: string;
  initialName: string;
  initialSheet: Record<string, unknown>;
  portraitUrl: string | null;
  editable: boolean;
};

const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"] as const;

export function CharacterSheetEditor(props: Props) {
  const [name, setName] = useState(props.initialName);
  const [sheet, setSheet] = useState<Sheet>(props.initialSheet as Sheet);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const persist = useCallback(
    async (next: { name: string; sheet: Sheet }) => {
      setErr(null);
      try {
        const r = await fetch(`/api/characters/${props.characterId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(next),
        });
        if (!r.ok) throw new Error(`save failed (${r.status})`);
        setSavedAt(new Date());
      } catch (e) {
        setErr(e instanceof Error ? e.message : "failed");
      }
    },
    [props.characterId],
  );

  useEffect(() => {
    if (!props.editable) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      persist({ name, sheet });
    }, 800);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [name, sheet, persist, props.editable]);

  const abilities = sheet.abilities ?? {
    str: 10,
    dex: 10,
    con: 10,
    int: 10,
    wis: 10,
    cha: 10,
  };
  const pb = sheet.proficiencyBonus ?? 2;
  const savingThrows = {
    str: false,
    dex: false,
    con: false,
    int: false,
    wis: false,
    cha: false,
    ...(sheet.savingThrows ?? {}),
  };
  const inventory = sheet.inventory ?? [];
  const spells = sheet.spells ?? [];
  const features = sheet.features ?? [];

  return (
    <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
      <aside className="space-y-4">
        <div className="panel overflow-hidden">
          {props.portraitUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={props.portraitUrl}
              alt={name}
              className="aspect-[3/4] w-full object-cover"
            />
          ) : (
            <div className="flex aspect-[3/4] w-full items-center justify-center bg-ink-600 text-xs text-ink-200">
              portrait pending
            </div>
          )}
        </div>
        <div className="panel p-3 text-xs text-ink-200">
          <p>
            Status:{" "}
            {props.editable
              ? savedAt
                ? `saved ${savedAt.toLocaleTimeString()}`
                : "unsaved"
              : "read-only"}
          </p>
          {err ? <p className="text-blood-500">{err}</p> : null}
        </div>
      </aside>

      <section className="space-y-5">
        <header>
          <input
            disabled={!props.editable}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-md border border-brass-700/30 bg-transparent font-display text-3xl text-parchment-100 focus:border-brass-400/60 focus:outline-none"
          />
          <p className="mt-1 text-sm text-brass-300">
            Level {sheet.level ?? 1} {sheet.race} {sheet.class}
            {sheet.background ? ` · ${sheet.background}` : ""}
            {sheet.alignment ? ` · ${sheet.alignment}` : ""}
          </p>
        </header>

        <div className="panel grid grid-cols-3 gap-3 p-4 text-center sm:grid-cols-6">
          {ABILITIES.map((k) => (
            <div key={k}>
              <p className="font-display text-[10px] uppercase tracking-wider text-brass-400">
                {k}
              </p>
              <input
                disabled={!props.editable}
                type="number"
                min={1}
                max={30}
                value={abilities[k]}
                onChange={(e) =>
                  setSheet({
                    ...sheet,
                    abilities: { ...abilities, [k]: Number(e.target.value) },
                  })
                }
                className="mt-1 w-full rounded-md border border-brass-700/40 bg-ink-500/70 px-1 py-1 text-center font-display text-xl text-parchment-100 focus:border-brass-400/60 focus:outline-none disabled:opacity-80"
              />
              <p className="mt-1 text-xs text-ink-100">
                {mod(abilities[k]) >= 0 ? "+" : ""}
                {mod(abilities[k])}
              </p>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat
            label="HP"
            cur={sheet.hpCurrent ?? sheet.hpMax ?? 10}
            max={sheet.hpMax ?? 10}
            onChange={(cur, max) =>
              setSheet({ ...sheet, hpCurrent: cur, hpMax: max })
            }
            editable={props.editable}
          />
          <NumStat
            label="AC"
            value={sheet.ac ?? 10}
            onChange={(v) => setSheet({ ...sheet, ac: v })}
            editable={props.editable}
          />
          <NumStat
            label="Speed"
            value={sheet.speed ?? 30}
            onChange={(v) => setSheet({ ...sheet, speed: v })}
            editable={props.editable}
          />
          <NumStat
            label="Prof. bonus"
            value={pb}
            onChange={(v) => setSheet({ ...sheet, proficiencyBonus: v })}
            editable={props.editable}
          />
        </div>

        <details className="panel" open>
          <summary className="cursor-pointer px-4 py-2 font-display text-sm uppercase tracking-[0.3em] text-brass-400">
            Saving Throws
          </summary>
          <div className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-3 lg:grid-cols-6">
            {ABILITIES.map((ability) => {
              const proficient = Boolean(savingThrows[ability]);
              const total = mod(abilities[ability]) + (proficient ? pb : 0);
              return (
                <button
                  key={ability}
                  type="button"
                  disabled={!props.editable}
                  onClick={() =>
                    setSheet({
                      ...sheet,
                      savingThrows: {
                        ...savingThrows,
                        [ability]: !proficient,
                      },
                    })
                  }
                  className={cn(
                    "rounded-md border px-3 py-2 text-left transition disabled:cursor-default",
                    proficient
                      ? "border-brass-400/60 bg-brass-700/30 text-parchment-100"
                      : "border-brass-700/40 bg-ink-600/40 text-ink-100 hover:border-brass-400/40",
                  )}
                >
                  <span className="block font-display text-[10px] uppercase tracking-wider">
                    {ability}
                  </span>
                  <span className="text-lg text-parchment-100">
                    {total >= 0 ? "+" : ""}
                    {total}
                  </span>
                  <span className="block text-[10px] text-ink-200">
                    {proficient ? "proficient" : "none"}
                  </span>
                </button>
              );
            })}
          </div>
        </details>

        <details className="panel" open>
          <summary className="cursor-pointer px-4 py-2 font-display text-sm uppercase tracking-[0.3em] text-brass-400">
            Skills
          </summary>
          <ul className="grid grid-cols-2 gap-1 p-4 text-sm sm:grid-cols-3">
            {SKILL_LIST.map((s) => {
              const state = sheet.skills?.[s] ?? "none";
              return (
                <li key={s} className="flex items-center justify-between">
                  <button
                    type="button"
                    disabled={!props.editable}
                    onClick={() => {
                      const next =
                        state === "none"
                          ? "proficient"
                          : state === "proficient"
                            ? "expert"
                            : "none";
                      setSheet({
                        ...sheet,
                        skills: { ...(sheet.skills ?? {}), [s]: next },
                      });
                    }}
                    className={cn(
                      "flex w-full justify-between rounded-md px-2 py-1 text-left transition",
                      state === "expert"
                        ? "bg-brass-700/40 text-parchment-100"
                        : state === "proficient"
                          ? "bg-brass-700/20 text-brass-300"
                          : "text-ink-100 hover:bg-ink-500/40",
                    )}
                  >
                    <span>{s}</span>
                    <span className="text-xs">
                      {state === "expert"
                        ? "exp"
                        : state === "proficient"
                          ? "prof"
                          : "none"}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </details>

        <details className="panel">
          <summary className="cursor-pointer px-4 py-2 font-display text-sm uppercase tracking-[0.3em] text-brass-400">
            Inventory & Notes
          </summary>
          <div className="space-y-5 p-4 text-sm">
            <div className="grid gap-3 md:grid-cols-2">
              <label className="block">
                <span className="font-display text-[10px] uppercase tracking-wider text-brass-400">
                  Appearance
                </span>
                <textarea
                  disabled={!props.editable}
                  rows={4}
                  value={sheet.appearance ?? ""}
                  onChange={(e) =>
                    setSheet({ ...sheet, appearance: e.target.value })
                  }
                  className="mt-1 w-full rounded-md border border-brass-700/40 bg-ink-500/70 px-3 py-2 text-parchment-100 placeholder:text-ink-200 focus:border-brass-400/60 focus:outline-none"
                />
              </label>
              <label className="block">
                <span className="font-display text-[10px] uppercase tracking-wider text-brass-400">
                  Backstory
                </span>
                <textarea
                  disabled={!props.editable}
                  rows={4}
                  value={sheet.backstory ?? ""}
                  onChange={(e) =>
                    setSheet({ ...sheet, backstory: e.target.value })
                  }
                  className="mt-1 w-full rounded-md border border-brass-700/40 bg-ink-500/70 px-3 py-2 text-parchment-100 placeholder:text-ink-200 focus:border-brass-400/60 focus:outline-none"
                />
              </label>
            </div>

            <EditableList
              title="Inventory"
              editable={props.editable}
              emptyLabel="No carried items."
              onAdd={() =>
                setSheet({
                  ...sheet,
                  inventory: inventory.concat({ name: "", qty: 1, notes: "" }),
                })
              }
            >
              {inventory.map((item, i) => (
                <div
                  key={i}
                  className="grid gap-2 border-t border-brass-700/30 py-2 first:border-t-0 sm:grid-cols-[1fr_72px_1fr_auto]"
                >
                  <input
                    disabled={!props.editable}
                    value={item.name}
                    onChange={(e) =>
                      setSheet({
                        ...sheet,
                        inventory: replaceAt(inventory, i, {
                          ...item,
                          name: e.target.value,
                        }),
                      })
                    }
                    placeholder="Item"
                    className="rounded-md border border-brass-700/40 bg-ink-500/70 px-2 py-1 text-parchment-100 placeholder:text-ink-200 focus:border-brass-400/60 focus:outline-none"
                  />
                  <input
                    disabled={!props.editable}
                    type="number"
                    min={0}
                    value={item.qty}
                    onChange={(e) =>
                      setSheet({
                        ...sheet,
                        inventory: replaceAt(inventory, i, {
                          ...item,
                          qty: Number(e.target.value),
                        }),
                      })
                    }
                    className="rounded-md border border-brass-700/40 bg-ink-500/70 px-2 py-1 text-parchment-100 focus:border-brass-400/60 focus:outline-none"
                  />
                  <input
                    disabled={!props.editable}
                    value={item.notes ?? ""}
                    onChange={(e) =>
                      setSheet({
                        ...sheet,
                        inventory: replaceAt(inventory, i, {
                          ...item,
                          notes: e.target.value,
                        }),
                      })
                    }
                    placeholder="Notes"
                    className="rounded-md border border-brass-700/40 bg-ink-500/70 px-2 py-1 text-parchment-100 placeholder:text-ink-200 focus:border-brass-400/60 focus:outline-none"
                  />
                  <RemoveButton
                    editable={props.editable}
                    onClick={() =>
                      setSheet({ ...sheet, inventory: removeAt(inventory, i) })
                    }
                  />
                </div>
              ))}
            </EditableList>

            <EditableList
              title="Spells"
              editable={props.editable}
              emptyLabel="No spells recorded."
              onAdd={() =>
                setSheet({
                  ...sheet,
                  spells: spells.concat({ name: "", level: 0, prepared: true }),
                })
              }
            >
              {spells.map((spell, i) => (
                <div
                  key={i}
                  className="grid gap-2 border-t border-brass-700/30 py-2 first:border-t-0 sm:grid-cols-[1fr_80px_120px_auto]"
                >
                  <input
                    disabled={!props.editable}
                    value={spell.name}
                    onChange={(e) =>
                      setSheet({
                        ...sheet,
                        spells: replaceAt(spells, i, {
                          ...spell,
                          name: e.target.value,
                        }),
                      })
                    }
                    placeholder="Spell"
                    className="rounded-md border border-brass-700/40 bg-ink-500/70 px-2 py-1 text-parchment-100 placeholder:text-ink-200 focus:border-brass-400/60 focus:outline-none"
                  />
                  <input
                    disabled={!props.editable}
                    type="number"
                    min={0}
                    max={9}
                    value={spell.level}
                    onChange={(e) =>
                      setSheet({
                        ...sheet,
                        spells: replaceAt(spells, i, {
                          ...spell,
                          level: Number(e.target.value),
                        }),
                      })
                    }
                    className="rounded-md border border-brass-700/40 bg-ink-500/70 px-2 py-1 text-parchment-100 focus:border-brass-400/60 focus:outline-none"
                  />
                  <button
                    type="button"
                    disabled={!props.editable}
                    onClick={() =>
                      setSheet({
                        ...sheet,
                        spells: replaceAt(spells, i, {
                          ...spell,
                          prepared: !spell.prepared,
                        }),
                      })
                    }
                    className={cn(
                      "rounded-md border px-2 py-1 text-xs",
                      spell.prepared
                        ? "border-brass-400/60 bg-brass-700/30 text-parchment-100"
                        : "border-brass-700/40 bg-ink-600/40 text-ink-100",
                    )}
                  >
                    {spell.prepared ? "prepared" : "known"}
                  </button>
                  <RemoveButton
                    editable={props.editable}
                    onClick={() =>
                      setSheet({ ...sheet, spells: removeAt(spells, i) })
                    }
                  />
                </div>
              ))}
            </EditableList>

            <EditableList
              title="Features"
              editable={props.editable}
              emptyLabel="No features recorded."
              onAdd={() =>
                setSheet({
                  ...sheet,
                  features: features.concat({
                    name: "",
                    source: "",
                    description: "",
                  }),
                })
              }
            >
              {features.map((feature, i) => (
                <div
                  key={i}
                  className="grid gap-2 border-t border-brass-700/30 py-2 first:border-t-0 sm:grid-cols-[1fr_140px_auto]"
                >
                  <input
                    disabled={!props.editable}
                    value={feature.name}
                    onChange={(e) =>
                      setSheet({
                        ...sheet,
                        features: replaceAt(features, i, {
                          ...feature,
                          name: e.target.value,
                        }),
                      })
                    }
                    placeholder="Feature"
                    className="rounded-md border border-brass-700/40 bg-ink-500/70 px-2 py-1 text-parchment-100 placeholder:text-ink-200 focus:border-brass-400/60 focus:outline-none"
                  />
                  <input
                    disabled={!props.editable}
                    value={feature.source}
                    onChange={(e) =>
                      setSheet({
                        ...sheet,
                        features: replaceAt(features, i, {
                          ...feature,
                          source: e.target.value,
                        }),
                      })
                    }
                    placeholder="Source"
                    className="rounded-md border border-brass-700/40 bg-ink-500/70 px-2 py-1 text-parchment-100 placeholder:text-ink-200 focus:border-brass-400/60 focus:outline-none"
                  />
                  <RemoveButton
                    editable={props.editable}
                    onClick={() =>
                      setSheet({ ...sheet, features: removeAt(features, i) })
                    }
                  />
                  <textarea
                    disabled={!props.editable}
                    rows={2}
                    value={feature.description}
                    onChange={(e) =>
                      setSheet({
                        ...sheet,
                        features: replaceAt(features, i, {
                          ...feature,
                          description: e.target.value,
                        }),
                      })
                    }
                    placeholder="Description"
                    className="rounded-md border border-brass-700/40 bg-ink-500/70 px-2 py-1 text-parchment-100 placeholder:text-ink-200 focus:border-brass-400/60 focus:outline-none sm:col-span-3"
                  />
                </div>
              ))}
            </EditableList>

            <label className="block">
              <span className="font-display text-[10px] uppercase tracking-wider text-brass-400">
                Session notes
              </span>
              <textarea
                disabled={!props.editable}
                rows={4}
                value={sheet.notes ?? ""}
                onChange={(e) => setSheet({ ...sheet, notes: e.target.value })}
                placeholder="Notes"
                className="mt-1 w-full rounded-md border border-brass-700/40 bg-ink-500/70 px-3 py-2 text-parchment-100 placeholder:text-ink-200 focus:border-brass-400/60 focus:outline-none"
              />
            </label>
          </div>
        </details>
      </section>
    </div>
  );
}

function EditableList({
  title,
  editable,
  emptyLabel,
  onAdd,
  children,
}: {
  title: string;
  editable: boolean;
  emptyLabel: string;
  onAdd: () => void;
  children: React.ReactNode;
}) {
  const isEmpty = Array.isArray(children) && children.length === 0;
  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-3">
        <h4 className="font-display text-[10px] uppercase tracking-wider text-brass-400">
          {title}
        </h4>
        <button
          type="button"
          disabled={!editable}
          onClick={onAdd}
          className="rounded-md border border-brass-700/40 bg-ink-600/50 px-2 py-1 text-[11px] text-brass-300 hover:border-brass-400/60 disabled:opacity-50"
        >
          Add
        </button>
      </div>
      {isEmpty ? (
        <p className="text-xs text-ink-200">{emptyLabel}</p>
      ) : (
        children
      )}
    </section>
  );
}

function RemoveButton({
  editable,
  onClick,
}: {
  editable: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={!editable}
      onClick={onClick}
      className="rounded-md border border-blood-500/40 bg-blood-600/20 px-2 py-1 text-xs text-blood-500 hover:bg-blood-600/30 disabled:opacity-50"
    >
      Remove
    </button>
  );
}

function replaceAt<T>(items: T[], index: number, item: T): T[] {
  return items.map((candidate, i) => (i === index ? item : candidate));
}

function removeAt<T>(items: T[], index: number): T[] {
  return items.filter((_candidate, i) => i !== index);
}

function Stat({
  label,
  cur,
  max,
  onChange,
  editable,
}: {
  label: string;
  cur: number;
  max: number;
  onChange: (cur: number, max: number) => void;
  editable: boolean;
}) {
  return (
    <div className="panel p-3 text-center">
      <p className="font-display text-[10px] uppercase tracking-wider text-brass-400">
        {label}
      </p>
      <div className="mt-1 flex items-center justify-center gap-1 text-xl text-parchment-100">
        <input
          disabled={!editable}
          type="number"
          value={cur}
          onChange={(e) => onChange(Number(e.target.value), max)}
          className="w-12 rounded-md border border-brass-700/40 bg-ink-500/70 px-1 py-0.5 text-center font-display focus:border-brass-400/60 focus:outline-none"
        />
        <span className="text-ink-200">/</span>
        <input
          disabled={!editable}
          type="number"
          value={max}
          onChange={(e) => onChange(cur, Number(e.target.value))}
          className="w-12 rounded-md border border-brass-700/40 bg-ink-500/70 px-1 py-0.5 text-center font-display focus:border-brass-400/60 focus:outline-none"
        />
      </div>
    </div>
  );
}

function NumStat({
  label,
  value,
  onChange,
  editable,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  editable: boolean;
}) {
  return (
    <div className="panel p-3 text-center">
      <p className="font-display text-[10px] uppercase tracking-wider text-brass-400">
        {label}
      </p>
      <input
        disabled={!editable}
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full rounded-md border border-brass-700/40 bg-ink-500/70 px-2 py-1 text-center font-display text-xl text-parchment-100 focus:border-brass-400/60 focus:outline-none"
      />
    </div>
  );
}
