"use client";

import { useCallback, useEffect, useState } from "react";
import { TerminalPanel } from "./TerminalPanel";

type SettingsState = {
  hasOpenAIKey: boolean;
  hasGlobalOpenAIKey: boolean;
  llm: {
    provider: "codex-cli" | "openai-api";
    codexModel: string;
    apiFallbackModel: string;
  };
  assets: {
    provider: "codex-cli" | "openai-api";
  };
  codex: {
    available: boolean;
    authenticated: boolean;
    detail: string;
  };
  fallback: {
    hasUserKey: boolean;
    hasGlobalKey: boolean;
    userBaseUrl: string | null;
    userModelDm: string | null;
    effectiveBaseUrl: string;
    effectiveModelDm: string;
    configured: boolean;
  };
  terminal: {
    enabled: boolean;
    idleMinutes: number;
  };
};

export function SettingsForm() {
  const [settings, setSettings] = useState<SettingsState | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [baseUrlInput, setBaseUrlInput] = useState("");
  const [modelInput, setModelInput] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const loadSettings = useCallback(async () => {
    const data = await fetch("/api/dm/settings")
      .then((r) => r.json())
      .catch(() => null);
    if (!data) {
      setSettings(null);
      return;
    }
    setSettings(data);
    setBaseUrlInput(
      data.fallback?.userBaseUrl ?? data.fallback?.effectiveBaseUrl ?? "",
    );
    setModelInput(
      data.fallback?.userModelDm ?? data.fallback?.effectiveModelDm ?? "",
    );
  }, []);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  async function saveFallback() {
    setMsg(null);
    setErr(null);
    const r = await fetch("/api/dm/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        openaiKey: keyInput || undefined,
        openaiBaseUrl: baseUrlInput,
        openaiModelDm: modelInput,
      }),
    });
    const j = await r.json();
    if (!r.ok) {
      setErr(j.error ?? "failed");
      return;
    }
    setSettings((prev) =>
      prev
        ? {
            ...prev,
            fallback: j.fallback,
            hasOpenAIKey: !!j.hasOpenAIKey,
            llm: { ...prev.llm, apiFallbackModel: j.fallback.effectiveModelDm },
          }
        : prev,
    );
    setKeyInput("");
    setMsg("Saved.");
  }

  async function clear() {
    setMsg(null);
    setErr(null);
    const r = await fetch("/api/dm/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clearKey: true }),
    });
    const j = await r.json();
    if (!r.ok) {
      setErr(j.error ?? "failed");
      return;
    }
    setSettings((prev) =>
      prev
        ? { ...prev, fallback: j.fallback, hasOpenAIKey: !!j.hasOpenAIKey }
        : prev,
    );
    setMsg("Cleared.");
  }

  const fallbackState =
    settings === null
      ? "..."
      : settings.fallback.configured
        ? settings.fallback.hasUserKey
          ? "ready with saved key"
          : "ready with env key"
        : "not configured";

  return (
    <div className="space-y-6">
      <section className="panel space-y-4 p-6">
        <h2 className="font-display text-lg text-parchment-100">DM runtime</h2>
        <div className="grid gap-3 text-xs md:grid-cols-4">
          <div className="rounded-md border border-brass-700/40 bg-ink-600/60 p-3">
            <div className="text-ink-100">Primary</div>
            <div className="mt-1 text-parchment-100">
              {settings?.llm.provider === "openai-api"
                ? "API fallback"
                : "Codex CLI"}
            </div>
            <div className="mt-1 text-ink-100">
              {settings?.llm.provider === "openai-api"
                ? settings?.llm.apiFallbackModel
                : settings?.llm.codexModel}
            </div>
          </div>
          <div className="rounded-md border border-brass-700/40 bg-ink-600/60 p-3">
            <div className="text-ink-100">Codex login</div>
            <div
              className={
                settings?.codex.authenticated
                  ? "mt-1 text-brass-300"
                  : "mt-1 text-blood-500"
              }
            >
              {settings === null
                ? "..."
                : settings.codex.authenticated
                  ? "logged in"
                  : settings.codex.available
                    ? "not logged in"
                    : "unavailable"}
            </div>
            <div className="mt-1 truncate text-ink-100">
              {settings?.codex.detail ?? ""}
            </div>
          </div>
          <div className="rounded-md border border-brass-700/40 bg-ink-600/60 p-3">
            <div className="text-ink-100">Asset images</div>
            <div className="mt-1 text-parchment-100">
              {settings?.assets.provider === "openai-api"
                ? "OpenAI API"
                : "Codex CLI"}
            </div>
            <div className="mt-1 truncate text-ink-100">
              {settings?.assets.provider === "openai-api"
                ? fallbackState
                : settings?.codex.authenticated
                  ? "uses ChatGPT/Codex login"
                  : "login required in worker"}
            </div>
          </div>
          <div className="rounded-md border border-brass-700/40 bg-ink-600/60 p-3">
            <div className="text-ink-100">API fallback</div>
            <div
              className={
                settings?.fallback.configured
                  ? "mt-1 text-brass-300"
                  : "mt-1 text-blood-500"
              }
            >
              {fallbackState}
            </div>
            <div className="mt-1 truncate text-ink-100">
              {settings?.fallback.effectiveModelDm ?? ""}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void loadSettings()}
          className="rounded-md border border-brass-700/40 bg-ink-600/40 px-3 py-2 text-xs text-parchment-100 hover:bg-ink-500/50"
        >
          Refresh status
        </button>
      </section>

      <section className="panel space-y-4 p-6">
        <h2 className="font-display text-lg text-parchment-100">OpenAI API</h2>
        <p className="text-xs text-ink-100">
          Asset jobs use Codex CLI image generation by default, using the same
          ChatGPT/Codex login as the DM loop. This key is only the OpenAI API
          fallback or the primary path when ASSET_IMAGE_PROVIDER=openai-api.
        </p>
        <div className="text-xs">
          Current:{" "}
          <span
            className={
              settings?.fallback.configured
                ? "rounded-full border border-brass-400/60 bg-brass-700/30 px-2 py-0.5 text-brass-300"
                : "rounded-full border border-ink-200/40 bg-ink-500/60 px-2 py-0.5 text-ink-200"
            }
          >
            {fallbackState}
          </span>
        </div>

        <div className="grid gap-3 md:grid-cols-[1.3fr_0.7fr]">
          <label className="space-y-1 text-xs text-ink-100">
            <span>API URL</span>
            <input
              type="url"
              value={baseUrlInput}
              onChange={(e) => setBaseUrlInput(e.target.value)}
              placeholder="https://api.openai.com/v1"
              className="w-full rounded-md border border-brass-700/40 bg-ink-500/70 px-3 py-2 text-sm text-parchment-100 focus:border-brass-400/60 focus:outline-none"
            />
          </label>
          <label className="space-y-1 text-xs text-ink-100">
            <span>Model</span>
            <input
              type="text"
              value={modelInput}
              onChange={(e) => setModelInput(e.target.value)}
              placeholder="gpt-5"
              className="w-full rounded-md border border-brass-700/40 bg-ink-500/70 px-3 py-2 text-sm text-parchment-100 focus:border-brass-400/60 focus:outline-none"
            />
          </label>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            type="password"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            placeholder="API key"
            className="flex-1 rounded-md border border-brass-700/40 bg-ink-500/70 px-3 py-2 text-sm text-parchment-100 focus:border-brass-400/60 focus:outline-none"
          />
          <button
            type="button"
            disabled={!baseUrlInput || !modelInput}
            onClick={saveFallback}
            className="rounded-md border border-arcane-500/60 bg-arcane-600/30 px-3 py-2 text-sm text-parchment-100 hover:bg-arcane-500/40 disabled:opacity-50"
          >
            Save fallback
          </button>
          {settings?.fallback.hasUserKey ? (
            <button
              type="button"
              onClick={clear}
              className="rounded-md border border-blood-500/40 bg-blood-600/20 px-3 py-2 text-sm text-blood-500 hover:bg-blood-600/30"
            >
              Clear
            </button>
          ) : null}
        </div>

        {msg ? <p className="text-xs text-brass-300">{msg}</p> : null}
        {err ? <p className="text-xs text-blood-500">{err}</p> : null}
      </section>

      {settings ? (
        <TerminalPanel
          enabled={settings.terminal.enabled}
          idleMinutes={settings.terminal.idleMinutes}
        />
      ) : (
        <section className="panel p-6">
          <h2 className="font-display text-lg text-parchment-100">
            Container terminal
          </h2>
          <p className="mt-1 text-xs text-ink-100">Loading settings.</p>
        </section>
      )}
    </div>
  );
}
