"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";

type FormState = {
  title: string;
  theme: string;
  tone: string;
  partySize: number;
  partyLevel: number;
  sessionLengthHours: number;
  houseRules: string;
  seedIdeas: string;
};

const PRESETS = [
  {
    label: "Lost Mine of Phandelver-ish",
    theme: "classic high fantasy with goblin raids and an old dwarven mine",
    tone: "earnest, heroic, with comic relief",
  },
  {
    label: "Coastal noir",
    theme: "smuggler-port intrigue with sea-witch politics",
    tone: "wet, paranoid, neon-lit by storm-glow",
  },
  {
    label: "Bone Cathedral",
    theme: "necropolis siege beneath a fallen god's ribcage",
    tone: "grimdark, lyrical, doom-laced",
  },
  {
    label: "Sky-Heist",
    theme: "airship caper across a continent of floating islands",
    tone: "swashbuckling, witty, ambitious",
  },
];

export function WorldbuildWizard() {
  const router = useRouter();
  const [step, setStep] = useState<"form" | "drafting" | "done">("form");
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>({
    title: "",
    theme: "",
    tone: "",
    partySize: 4,
    partyLevel: 3,
    sessionLengthHours: 3,
    houseRules: "",
    seedIdeas: "",
  });

  async function submit() {
    setError(null);
    setStep("drafting");
    try {
      const r = await fetch("/api/dm/worldbuild", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error ?? `request failed (${r.status})`);
      }
      const { campaignId } = (await r.json()) as { campaignId: string };
      router.push(`/campaigns/${campaignId}/assets`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed");
      setStep("form");
    }
  }

  if (step === "drafting") {
    return (
      <div className="panel p-8 text-center">
        <p className="font-display text-xs uppercase tracking-[0.4em] text-brass-400">
          Drafting
        </p>
        <h2 className="mt-2 font-display text-2xl text-parchment-100">
          Codex is forging your world…
        </h2>
        <p className="mt-3 font-serif text-ink-100">
          Plot, factions, NPCs, locations, items, encounters. Asset jobs are
          being queued for portraits and backgrounds. This usually takes
          30–90 seconds.
        </p>
        <div className="mt-6 h-1 w-full overflow-hidden rounded bg-ink-500">
          <div className="h-full w-1/3 animate-pulse bg-brass-500/60" />
        </div>
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="space-y-6"
    >
      <Field label="Title" required>
        <input
          required
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          placeholder="The Whispering Mire"
          className="w-full rounded-md border border-brass-700/40 bg-ink-500/70 px-3 py-2 text-parchment-100 placeholder:text-ink-200 focus:border-brass-400/60 focus:outline-none"
        />
      </Field>

      <Field
        label="Theme"
        required
        hint="One sentence: what kind of adventure are we running?"
      >
        <textarea
          required
          rows={2}
          value={form.theme}
          onChange={(e) => setForm({ ...form, theme: e.target.value })}
          placeholder="Sword & sorcery investigation in a drowned city"
          className="w-full rounded-md border border-brass-700/40 bg-ink-500/70 px-3 py-2 text-parchment-100 placeholder:text-ink-200 focus:border-brass-400/60 focus:outline-none"
        />
        <div className="mt-2 flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <button
              type="button"
              key={p.label}
              onClick={() =>
                setForm({ ...form, theme: p.theme, tone: p.tone, title: form.title || p.label })
              }
              className="rounded-full border border-brass-700/40 bg-ink-600/60 px-3 py-1 text-xs text-brass-300 hover:border-brass-400/60 hover:text-parchment-200"
            >
              {p.label}
            </button>
          ))}
        </div>
      </Field>

      <Field label="Tone" hint="Adjectives or short phrases.">
        <input
          value={form.tone}
          onChange={(e) => setForm({ ...form, tone: e.target.value })}
          placeholder="grim, lyrical, doom-laced"
          className="w-full rounded-md border border-brass-700/40 bg-ink-500/70 px-3 py-2 text-parchment-100 placeholder:text-ink-200 focus:border-brass-400/60 focus:outline-none"
        />
      </Field>

      <div className="grid grid-cols-3 gap-4">
        <Field label="Party size">
          <input
            type="number"
            min={1}
            max={8}
            value={form.partySize}
            onChange={(e) => setForm({ ...form, partySize: Number(e.target.value) })}
            className="w-full rounded-md border border-brass-700/40 bg-ink-500/70 px-3 py-2 text-parchment-100 focus:border-brass-400/60 focus:outline-none"
          />
        </Field>
        <Field label="Starting level">
          <input
            type="number"
            min={1}
            max={20}
            value={form.partyLevel}
            onChange={(e) => setForm({ ...form, partyLevel: Number(e.target.value) })}
            className="w-full rounded-md border border-brass-700/40 bg-ink-500/70 px-3 py-2 text-parchment-100 focus:border-brass-400/60 focus:outline-none"
          />
        </Field>
        <Field label="Target session (hrs)">
          <input
            type="number"
            min={1}
            max={12}
            value={form.sessionLengthHours}
            onChange={(e) =>
              setForm({ ...form, sessionLengthHours: Number(e.target.value) })
            }
            className="w-full rounded-md border border-brass-700/40 bg-ink-500/70 px-3 py-2 text-parchment-100 focus:border-brass-400/60 focus:outline-none"
          />
        </Field>
      </div>

      <Field label="House rules" hint="Optional.">
        <textarea
          rows={3}
          value={form.houseRules}
          onChange={(e) => setForm({ ...form, houseRules: e.target.value })}
          placeholder="critical fumbles on a natural 1, milestone leveling, etc."
          className="w-full rounded-md border border-brass-700/40 bg-ink-500/70 px-3 py-2 text-parchment-100 placeholder:text-ink-200 focus:border-brass-400/60 focus:outline-none"
        />
      </Field>

      <Field label="Seed ideas" hint="Optional. NPCs, places, twists, anything specific you want included.">
        <textarea
          rows={4}
          value={form.seedIdeas}
          onChange={(e) => setForm({ ...form, seedIdeas: e.target.value })}
          placeholder="There should be a tiefling alchemist named Vellan, the climax happens in a flooded library"
          className="w-full rounded-md border border-brass-700/40 bg-ink-500/70 px-3 py-2 text-parchment-100 placeholder:text-ink-200 focus:border-brass-400/60 focus:outline-none"
        />
      </Field>

      {error ? (
        <p className="text-sm text-blood-500">{error}</p>
      ) : null}

      <div className="flex justify-end gap-3 pt-2">
        <button
          type="submit"
          className={cn(
            "rounded-md border border-arcane-500/60 bg-arcane-600/30 px-6 py-2 font-display text-sm uppercase tracking-wider text-parchment-100 transition",
            "hover:bg-arcane-500/40",
          )}
        >
          Forge campaign →
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
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
      {hint ? (
        <span className="mt-1 block text-xs text-ink-200">{hint}</span>
      ) : null}
    </label>
  );
}
