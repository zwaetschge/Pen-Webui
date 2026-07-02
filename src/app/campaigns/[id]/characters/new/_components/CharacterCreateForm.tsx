"use client";

import { useState } from "react";
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

export function CharacterCreateForm({
  campaignId,
  localMode = false,
}: {
  campaignId: string;
  localMode?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
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

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/characters", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          campaignId,
          name: form.name,
          sheet: {
            level: 1,
            class: form.class,
            race: form.race,
            background: form.background,
            alignment: form.alignment,
            appearance: form.appearance,
            backstory: form.backstory,
            abilities: {
              str: form.str,
              dex: form.dex,
              con: form.con,
              int: form.int,
              wis: form.wis,
              cha: form.cha,
            },
            hpMax: 10 + Math.floor((form.con - 10) / 2),
            hpCurrent: 10 + Math.floor((form.con - 10) / 2),
            ac: 10 + Math.floor((form.dex - 10) / 2),
          },
        }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error ?? "failed");
      }
      const { character } = (await r.json()) as { character: { id: string } };
      router.push(`/campaigns/${campaignId}/characters/${character.id}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <Field label="Name" required>
        <input
          required
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="Khazra Stoneflame"
          className="w-full rounded-md border border-brass-700/40 bg-ink-500/70 px-3 py-2 text-parchment-100 placeholder:text-ink-200 focus:border-brass-400/60 focus:outline-none"
        />
      </Field>

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
          {(["str", "dex", "con", "int", "wis", "cha"] as const).map((k) => (
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

      <Field label="Appearance">
        <textarea
          rows={2}
          value={form.appearance}
          onChange={(e) => setForm({ ...form, appearance: e.target.value })}
          placeholder="Tall, soot-black braids, a copper torc, eyes the colour of cooled lava."
          className="w-full rounded-md border border-brass-700/40 bg-ink-500/70 px-3 py-2 text-parchment-100 placeholder:text-ink-200 focus:border-brass-400/60 focus:outline-none"
        />
      </Field>

      <Field label="Backstory">
        <textarea
          rows={4}
          value={form.backstory}
          onChange={(e) => setForm({ ...form, backstory: e.target.value })}
          placeholder="A few sentences of where they came from and what they want."
          className="w-full rounded-md border border-brass-700/40 bg-ink-500/70 px-3 py-2 text-parchment-100 placeholder:text-ink-200 focus:border-brass-400/60 focus:outline-none"
        />
      </Field>

      {err ? <p className="text-sm text-blood-500">{err}</p> : null}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={busy || !form.name.trim()}
          className="rounded-md border border-arcane-500/60 bg-arcane-600/30 px-6 py-2 font-display text-sm uppercase tracking-wider text-parchment-100 transition hover:bg-arcane-500/40 disabled:opacity-50"
        >
          {busy
            ? "Saving…"
            : localMode
              ? "Save local character →"
              : "Roll up character →"}
        </button>
      </div>
    </form>
  );
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
