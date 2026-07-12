"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

const CLASSES = [
  "Barbarian",
  "Bard",
  "Cleric",
  "Druid",
  "Fighter",
  "Monk",
  "Paladin",
  "Ranger",
  "Rogue",
  "Sorcerer",
  "Warlock",
  "Wizard",
];
const RACES = [
  "Human",
  "Elf",
  "Dwarf",
  "Halfling",
  "Half-Elf",
  "Half-Orc",
  "Tiefling",
  "Dragonborn",
  "Gnome",
];
const ALIGNMENTS = [
  "Lawful Good",
  "Neutral Good",
  "Chaotic Good",
  "Lawful Neutral",
  "True Neutral",
  "Chaotic Neutral",
  "Lawful Evil",
  "Neutral Evil",
  "Chaotic Evil",
];
const BACKGROUNDS = [
  "Acolyte",
  "Charlatan",
  "Criminal",
  "Entertainer",
  "Folk Hero",
  "Guild Artisan",
  "Hermit",
  "Noble",
  "Outlander",
  "Sage",
  "Sailor",
  "Soldier",
  "Urchin",
];
const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"] as const;

type Mode = "template" | "custom";
type Ability = (typeof ABILITIES)[number];

export type CharacterTemplate = {
  id: string;
  name: string;
  role: string | null;
  description: string | null;
  portraitUrl: string | null;
};

export function CharacterCreateForm({
  campaignId,
  localMode = false,
  templates = [],
}: {
  campaignId: string;
  localMode?: boolean;
  templates?: CharacterTemplate[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>(
    templates.length > 0 ? "template" : "custom",
  );
  const [selectedTemplateId, setSelectedTemplateId] = useState(
    templates[0]?.id ?? "",
  );
  const [form, setForm] = useState({
    name: "",
    class: "Fighter",
    race: "Human",
    background: "Folk Hero",
    alignment: "Neutral Good",
    appearance: "",
    backstory: "",
    str: 15,
    dex: 14,
    con: 13,
    int: 12,
    wis: 10,
    cha: 8,
  });

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === selectedTemplateId),
    [selectedTemplateId, templates],
  );
  const usingTemplate = mode === "template" && Boolean(selectedTemplate);
  const canSubmit = usingTemplate || form.name.trim().length >= 2;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/characters", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          usingTemplate && selectedTemplate
            ? {
                campaignId,
                sourceNpcId: selectedTemplate.id,
                sheet: buildSheet(form),
              }
            : {
                campaignId,
                name: form.name,
                sheet: buildSheet(form),
              },
        ),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error ?? "failed");
      }
      const { character } = (await r.json()) as { character: { id: string } };
      router.push(`/campaigns/${campaignId}?characterCreated=${character.id}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      {templates.length > 0 ? (
        <div className="grid grid-cols-2 gap-2 rounded-md border border-brass-700/35 bg-ink-600/45 p-1">
          <button
            type="button"
            onClick={() => setMode("template")}
            className={modeButtonClass(mode === "template")}
          >
            Als Spielerfigur übernehmen
          </button>
          <button
            type="button"
            onClick={() => setMode("custom")}
            className={modeButtonClass(mode === "custom")}
          >
            Eigener Charakter
          </button>
        </div>
      ) : null}

      {mode === "template" && templates.length > 0 ? (
        <section>
          <h2 className="font-display text-xs uppercase tracking-[0.3em] text-brass-400">
            Kampagnenfiguren
          </h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {templates.map((template) => {
              const selected = template.id === selectedTemplateId;
              return (
                <button
                  key={template.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setSelectedTemplateId(template.id)}
                  className={[
                    "group grid min-h-40 grid-cols-[4.5rem_1fr] gap-3 rounded-md border p-3 text-left transition",
                    selected
                      ? "border-brass-300/80 bg-brass-700/25 shadow-brass"
                      : "border-brass-700/35 bg-ink-600/50 hover:border-brass-400/60",
                  ].join(" ")}
                >
                  <span className="relative h-28 overflow-hidden rounded-md border border-brass-700/40 bg-ink-500">
                    {template.portraitUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={template.portraitUrl}
                        alt={template.name}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <span className="flex h-full items-center justify-center font-display text-[10px] uppercase tracking-[0.2em] text-ink-200">
                        Portrait
                      </span>
                    )}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-display text-lg text-parchment-100">
                      {template.name}
                    </span>
                    {template.role ? (
                      <span className="mt-1 line-clamp-2 block font-serif text-xs text-brass-300">
                        {template.role}
                      </span>
                    ) : null}
                    {template.description ? (
                      <span className="mt-2 line-clamp-3 block font-serif text-xs leading-relaxed text-ink-100">
                        {template.description}
                      </span>
                    ) : null}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ) : (
        <Field label="Name" required>
          <input
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Khazra Stoneflame"
            className="w-full rounded-md border border-brass-700/40 bg-ink-500/70 px-3 py-2 text-parchment-100 placeholder:text-ink-200 focus:border-brass-400/60 focus:outline-none"
          />
        </Field>
      )}

      <div className="grid grid-cols-2 gap-4">
        <Select
          label="Class"
          value={form.class}
          onChange={(v) => setForm({ ...form, class: v })}
          options={CLASSES}
        />
        <Select
          label="Race"
          value={form.race}
          onChange={(v) => setForm({ ...form, race: v })}
          options={RACES}
        />
        <Select
          label="Background"
          value={form.background}
          onChange={(v) => setForm({ ...form, background: v })}
          options={BACKGROUNDS}
        />
        <Select
          label="Alignment"
          value={form.alignment}
          onChange={(v) => setForm({ ...form, alignment: v })}
          options={ALIGNMENTS}
        />
      </div>

      <fieldset>
        <legend className="font-display text-xs uppercase tracking-[0.3em] text-brass-400">
          Ability scores
        </legend>
        <div className="mt-2 grid grid-cols-6 gap-2">
          {ABILITIES.map((k) => (
            <label key={k} className="block">
              <span className="block text-center text-[10px] uppercase tracking-wider text-ink-200">
                {k}
              </span>
              <input
                type="number"
                min={3}
                max={20}
                value={form[k]}
                onChange={(e) =>
                  setForm({ ...form, [k]: Number(e.target.value) })
                }
                className="w-full rounded-md border border-brass-700/40 bg-ink-500/70 px-2 py-1 text-center font-display text-lg text-parchment-100 focus:border-brass-400/60 focus:outline-none"
              />
            </label>
          ))}
        </div>
      </fieldset>

      {mode === "custom" ? (
        <>
          <Field label="Appearance">
            <textarea
              rows={2}
              value={form.appearance}
              onChange={(e) =>
                setForm({ ...form, appearance: e.target.value })
              }
              placeholder="Tall, soot-black braids, a copper torc, eyes the colour of cooled lava."
              className="w-full rounded-md border border-brass-700/40 bg-ink-500/70 px-3 py-2 text-parchment-100 placeholder:text-ink-200 focus:border-brass-400/60 focus:outline-none"
            />
          </Field>

          <Field label="Backstory">
            <textarea
              rows={4}
              value={form.backstory}
              onChange={(e) =>
                setForm({ ...form, backstory: e.target.value })
              }
              placeholder="A few sentences of where they came from and what they want."
              className="w-full rounded-md border border-brass-700/40 bg-ink-500/70 px-3 py-2 text-parchment-100 placeholder:text-ink-200 focus:border-brass-400/60 focus:outline-none"
            />
          </Field>
        </>
      ) : null}

      {err ? <p className="text-sm text-blood-500">{err}</p> : null}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={busy || !canSubmit}
          className="rounded-md border border-arcane-500/60 bg-arcane-600/30 px-6 py-2 font-display text-sm uppercase tracking-wider text-parchment-100 transition hover:bg-arcane-500/40 disabled:opacity-50"
        >
          {busy
            ? "Wird gespeichert…"
            : usingTemplate
              ? "Als Spielerfigur übernehmen"
              : localMode
                ? "Figur für den Tisch anlegen"
                : "Charakter anlegen"}
        </button>
      </div>
    </form>
  );
}

function buildSheet(form: Record<string, string | number>) {
  const con = Number(form.con);
  const dex = Number(form.dex);
  return {
    level: 1,
    class: String(form.class),
    race: String(form.race),
    background: String(form.background),
    alignment: String(form.alignment),
    appearance: String(form.appearance ?? ""),
    backstory: String(form.backstory ?? ""),
    abilities: ABILITIES.reduce(
      (scores, ability) => ({
        ...scores,
        [ability]: Number(form[ability]),
      }),
      {} as Record<Ability, number>,
    ),
    hpMax: 10 + Math.floor((con - 10) / 2),
    hpCurrent: 10 + Math.floor((con - 10) / 2),
    ac: 10 + Math.floor((dex - 10) / 2),
  };
}

function modeButtonClass(active: boolean) {
  return [
    "rounded px-3 py-2 font-display text-[11px] uppercase tracking-[0.2em] transition focus:outline-none focus:ring-2 focus:ring-brass-300/50",
    active
      ? "bg-brass-700/45 text-parchment-50 shadow-brass"
      : "text-brass-300 hover:bg-ink-500/70",
  ].join(" ");
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="font-display text-xs uppercase tracking-[0.3em] text-brass-400">
        {label}
        {required ? " *" : ""}
      </span>
      <div className="mt-2">{children}</div>
    </label>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <Field label={label}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-brass-700/40 bg-ink-500/70 px-3 py-2 text-parchment-100 focus:border-brass-400/60 focus:outline-none"
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </Field>
  );
}
