"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { TerminalPanel } from "./TerminalPanel";
import {
  codexEffortPickerState,
  createSettingsRequestGate,
  requestSettings,
  type SettingsState,
} from "./settings-request";
import {
  fetchCodexUpdateStatus,
  requestCodexUpdate,
  type CodexUpdateStatus,
} from "./codex-update-request";

const CODEX_EFFORT_LABELS = {
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
} as const;

const CODEX_SOURCE_LABELS: Record<CodexUpdateStatus["source"], string> = {
  configured: "CODEX_BIN",
  managed: "persistent managed install",
  bundled: "bundled with Plum Tabletop",
  workspace: "workspace install",
  path: "system PATH",
};

export function SettingsForm() {
  const requestGate = useRef(createSettingsRequestGate());
  const [settings, setSettings] = useState<SettingsState | null>(null);
  const [requestPending, setRequestPending] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [baseUrlInput, setBaseUrlInput] = useState("");
  const [modelInput, setModelInput] = useState("");
  const [codexModelInput, setCodexModelInput] = useState("");
  const [codexEffortInput, setCodexEffortInput] = useState("");
  const [codexMsg, setCodexMsg] = useState<string | null>(null);
  const [codexErr, setCodexErr] = useState<string | null>(null);
  const [codexCompatibilityNote, setCodexCompatibilityNote] = useState<
    string | null
  >(null);
  const [codexUpdateStatus, setCodexUpdateStatus] =
    useState<CodexUpdateStatus | null>(null);
  const [codexUpdatePending, setCodexUpdatePending] = useState(false);
  const [codexUpdateMsg, setCodexUpdateMsg] = useState<string | null>(null);
  const [codexUpdateErr, setCodexUpdateErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const loadSettings = useCallback(async () => {
    if (!requestGate.current.acquire()) return;

    setRequestPending(true);
    setLoadError(null);

    try {
      const data = await requestSettings();
      setSettings(data);
      setBaseUrlInput(
        data.fallback.userBaseUrl ?? data.fallback.effectiveBaseUrl,
      );
      setModelInput(
        data.fallback.userModelDm ?? data.fallback.effectiveModelDm,
      );
      setCodexModelInput(data.codexRuntime.userModel ?? "");
      const effort = codexEffortPickerState(data);
      setCodexEffortInput(effort.value);
      setCodexCompatibilityNote(
        effort.unsupported
          ? `Saved reasoning effort “${effort.unsupported}” is no longer supported by this Codex model. Save once to use the installation default.`
          : null,
      );
    } catch (error) {
      setLoadError(
        error instanceof Error ? error.message : "Unable to load settings.",
      );
    } finally {
      requestGate.current.release();
      setRequestPending(false);
    }
  }, []);

  const loadCodexUpdateStatus = useCallback(async () => {
    try {
      setCodexUpdateStatus(await fetchCodexUpdateStatus());
      setCodexUpdateErr(null);
    } catch (error) {
      setCodexUpdateErr(
        error instanceof Error
          ? error.message
          : "Unable to load the Codex CLI version.",
      );
    }
  }, []);

  useEffect(() => {
    void loadSettings();
    void loadCodexUpdateStatus();
  }, [loadCodexUpdateStatus, loadSettings]);

  async function updateCodex() {
    setCodexUpdatePending(true);
    setCodexUpdateMsg(null);
    setCodexUpdateErr(null);

    try {
      const result = await requestCodexUpdate();
      setCodexUpdateStatus(result.status);
      if (result.changed && result.previousVersion) {
        setCodexUpdateMsg(
          `Codex CLI ${result.previousVersion} → ${result.currentVersion} updated.`,
        );
      } else if (result.changed) {
        setCodexUpdateMsg(`Codex CLI ${result.currentVersion} installed.`);
      } else {
        setCodexUpdateMsg(
          `Codex CLI ${result.currentVersion} is already current.`,
        );
      }
      await loadSettings();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Codex update failed.";
      setCodexUpdateErr(message);
      try {
        setCodexUpdateStatus(await fetchCodexUpdateStatus());
      } catch {
        // Keep the actionable update error instead of replacing it with a
        // secondary status-refresh failure.
      }
    } finally {
      setCodexUpdatePending(false);
    }
  }

  async function saveCodex() {
    if (!requestGate.current.acquire()) return;

    setRequestPending(true);
    setCodexMsg(null);
    setCodexErr(null);

    try {
      const body = await requestSettings({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          codexModelDm: codexModelInput.trim() || null,
          codexReasoningEffort: codexEffortInput || null,
        }),
      });

      setSettings((current) =>
        current
          ? {
              ...current,
              codexRuntime: body.codexRuntime,
              llm: {
                ...current.llm,
                codexModel: body.codexRuntime.effectiveModel,
              },
            }
          : current,
      );
      setCodexModelInput(body.codexRuntime.userModel ?? "");
      setCodexEffortInput(body.codexRuntime.userReasoningEffort ?? "");
      setCodexCompatibilityNote(null);
      setCodexMsg("Codex settings saved.");
    } catch (error) {
      setCodexErr(
        error instanceof Error ? error.message : "Codex settings failed",
      );
    } finally {
      requestGate.current.release();
      setRequestPending(false);
    }
  }

  async function saveFallback() {
    if (!requestGate.current.acquire()) return;

    setRequestPending(true);
    setMsg(null);
    setErr(null);

    try {
      const body = await requestSettings({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          openaiKey: keyInput || undefined,
          openaiBaseUrl: baseUrlInput,
          openaiModelDm: modelInput,
        }),
      });
      setSettings((current) =>
        current
          ? {
              ...current,
              fallback: body.fallback,
              hasOpenAIKey: body.hasOpenAIKey,
              llm: {
                ...current.llm,
                apiFallbackModel: body.fallback.effectiveModelDm,
              },
            }
          : current,
      );
      setKeyInput("");
      setMsg("Saved.");
    } catch (error) {
      setErr(
        error instanceof Error ? error.message : "Fallback settings failed.",
      );
    } finally {
      requestGate.current.release();
      setRequestPending(false);
    }
  }

  async function clear() {
    if (!requestGate.current.acquire()) return;

    setRequestPending(true);
    setMsg(null);
    setErr(null);

    try {
      const body = await requestSettings({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clearKey: true }),
      });
      setSettings((current) =>
        current
          ? {
              ...current,
              fallback: body.fallback,
              hasOpenAIKey: body.hasOpenAIKey,
            }
          : current,
      );
      setMsg("Cleared.");
    } catch (error) {
      setErr(
        error instanceof Error ? error.message : "Unable to clear the API key.",
      );
    } finally {
      requestGate.current.release();
      setRequestPending(false);
    }
  }

  const fallbackState =
    settings === null
      ? "..."
      : settings.fallback.configured
        ? settings.fallback.hasUserKey
          ? "ready with saved key"
          : "ready with env key"
        : "not configured";

  const selectedCatalogModel = settings
    ? codexModelInput
      ? settings.codexModels.models.find(
          (option) => option.model === codexModelInput,
        )
      : (settings.codexModels.models.find((option) => option.isDefault) ??
        settings.codexModels.models.find(
          (option) => option.model === settings.codexRuntime.effectiveModel,
        ))
    : undefined;
  const visibleReasoningEfforts = selectedCatalogModel
    ? selectedCatalogModel.supportedReasoningEfforts.map(
        (option) => option.reasoningEffort,
      )
    : Object.keys(CODEX_EFFORT_LABELS);

  function selectCodexModel(model: string) {
    setCodexModelInput(model);
    const option = model
      ? settings?.codexModels.models.find((item) => item.model === model)
      : settings?.codexModels.models.find((item) => item.isDefault);
    if (
      codexEffortInput &&
      option &&
      !option.supportedReasoningEfforts.some(
        (item) => item.reasoningEffort === codexEffortInput,
      )
    ) {
      setCodexEffortInput("");
      setCodexCompatibilityNote(
        "Reasoning effort was reset because the selected model does not support it.",
      );
    } else {
      setCodexCompatibilityNote(null);
    }
  }

  if (settings === null) {
    return (
      <section className="panel space-y-3 p-6">
        <h2 className="font-display text-lg text-parchment-100">DM settings</h2>
        {loadError ? (
          <>
            <p className="text-xs text-blood-500">{loadError}</p>
            <button
              type="button"
              disabled={requestPending}
              onClick={() => void loadSettings()}
              className="rounded-md border border-brass-700/40 bg-ink-600/40 px-3 py-2 text-xs text-parchment-100 hover:bg-ink-500/50 disabled:opacity-50"
            >
              Retry
            </button>
          </>
        ) : (
          <p className="text-xs text-ink-100">Loading settings.</p>
        )}
      </section>
    );
  }

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
            {settings?.llm.provider === "codex-cli" ? (
              <div className="mt-1 text-ink-100">
                Reasoning: {settings.codexRuntime.effectiveReasoningEffort}
              </div>
            ) : null}
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
          disabled={requestPending || codexUpdatePending}
          onClick={() => {
            void loadSettings();
            void loadCodexUpdateStatus();
          }}
          className="rounded-md border border-brass-700/40 bg-ink-600/40 px-3 py-2 text-xs text-parchment-100 hover:bg-ink-500/50 disabled:opacity-50"
        >
          Refresh status
        </button>
        {loadError ? (
          <p className="text-xs text-blood-500">{loadError}</p>
        ) : null}
      </section>

      <section className="panel space-y-4 p-6">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
          <div>
            <h2 className="font-display text-lg text-parchment-100">
              Codex CLI
            </h2>
            <p className="mt-1 text-[10px] uppercase tracking-[0.16em] text-brass-400">
              Dungeon Master runtime
            </p>
          </div>
          <div className="rounded-md border border-brass-700/40 bg-ink-600/60 px-3 py-2 text-xs">
            <span className="text-ink-100">Installed </span>
            <span className="font-mono text-parchment-100">
              {codexUpdateStatus?.currentVersion
                ? `v${codexUpdateStatus.currentVersion}`
                : "checking…"}
            </span>
            {codexUpdateStatus ? (
              <span className="ml-2 text-ink-100">
                {CODEX_SOURCE_LABELS[codexUpdateStatus.source]}
              </span>
            ) : null}
          </div>
        </div>
        <p className="text-xs text-ink-100">
          Override the Codex model and reasoning effort for your DM turns. Blank
          values use the installation defaults and do not change the OpenAI API
          fallback.
        </p>

        <div className="grid gap-3 md:grid-cols-[1.3fr_0.7fr]">
          <label className="space-y-1 text-xs text-ink-100">
            <span>Model</span>
            <select
              disabled={requestPending || codexUpdatePending}
              value={codexModelInput}
              onChange={(event) => selectCodexModel(event.target.value)}
              className="w-full rounded-md border border-brass-700/40 bg-ink-500/70 px-3 py-2 text-sm text-parchment-100 focus:border-brass-400/60 focus:outline-none"
            >
              <option value="">Installation default</option>
              {codexModelInput &&
              !settings.codexModels.models.some(
                (option) => option.model === codexModelInput,
              ) ? (
                <option value={codexModelInput}>
                  {codexModelInput} (currently saved)
                </option>
              ) : null}
              {settings.codexModels.models.map((option) => (
                <option key={option.model} value={option.model}>
                  {option.displayName}
                  {option.isDefault ? " — recommended" : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-xs text-ink-100">
            <span>Reasoning effort</span>
            <select
              disabled={requestPending || codexUpdatePending}
              value={codexEffortInput}
              onChange={(event) => {
                setCodexEffortInput(event.target.value);
                setCodexCompatibilityNote(null);
              }}
              className="w-full rounded-md border border-brass-700/40 bg-ink-500/70 px-3 py-2 text-sm text-parchment-100 focus:border-brass-400/60 focus:outline-none"
            >
              <option value="">Installation default</option>
              {Object.entries(CODEX_EFFORT_LABELS)
                .filter(([effort]) => visibleReasoningEfforts.includes(effort))
                .map(([effort, label]) => (
                  <option key={effort} value={effort}>
                    {label}
                  </option>
                ))}
            </select>
          </label>
        </div>

        {selectedCatalogModel?.description ? (
          <p className="text-xs text-ink-100">
            {selectedCatalogModel.description}
          </p>
        ) : null}
        {codexCompatibilityNote ? (
          <p className="rounded-md border border-brass-500/45 bg-brass-900/25 px-3 py-2 text-xs text-brass-300">
            {codexCompatibilityNote}
          </p>
        ) : null}
        <p
          className={
            settings.codexModels.available
              ? "text-xs text-ink-100"
              : "text-xs text-blood-500"
          }
        >
          {settings.codexModels.available
            ? "Model choices are loaded directly from Codex /model."
            : settings.codexModels.detail}
        </p>

        <div className="text-xs text-ink-100">
          Effective: {settings?.codexRuntime.effectiveModel ?? "..."}, reasoning{" "}
          {settings?.codexRuntime.effectiveReasoningEffort ?? "..."}
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <button
            type="button"
            disabled={requestPending || codexUpdatePending}
            onClick={() => void saveCodex()}
            className="rounded-md border border-arcane-500/60 bg-arcane-600/30 px-3 py-2 text-sm text-parchment-100 hover:bg-arcane-500/40 disabled:opacity-50"
          >
            Save Codex settings
          </button>
          <button
            type="button"
            disabled={
              requestPending ||
              codexUpdatePending ||
              !codexUpdateStatus?.canUpdate
            }
            onClick={() => void updateCodex()}
            className="rounded-md border border-brass-400/60 bg-brass-700/20 px-3 py-2 text-sm text-brass-300 hover:bg-brass-700/35 disabled:cursor-not-allowed disabled:opacity-45"
          >
            {codexUpdatePending ? "Updating Codex CLI…" : "Update Codex CLI"}
          </button>
          <span className="text-[11px] text-ink-100">
            Installs the latest CLI into the persistent Codex volume.
          </span>
        </div>

        {codexMsg ? <p className="text-xs text-brass-300">{codexMsg}</p> : null}
        {codexErr ? <p className="text-xs text-blood-500">{codexErr}</p> : null}
        <div aria-live="polite">
          {codexUpdateMsg ? (
            <p className="text-xs text-brass-300">{codexUpdateMsg}</p>
          ) : null}
          {codexUpdateErr ? (
            <p className="text-xs text-blood-500">{codexUpdateErr}</p>
          ) : null}
          {codexUpdateStatus && !codexUpdateStatus.canUpdate ? (
            <p className="text-xs text-ink-100">
              This installation is controlled by CODEX_BIN and must be updated
              by the server administrator.
            </p>
          ) : null}
        </div>
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
              disabled={requestPending}
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
              disabled={requestPending}
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
            disabled={requestPending}
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            placeholder="API key"
            className="flex-1 rounded-md border border-brass-700/40 bg-ink-500/70 px-3 py-2 text-sm text-parchment-100 focus:border-brass-400/60 focus:outline-none"
          />
          <button
            type="button"
            disabled={requestPending || !baseUrlInput || !modelInput}
            onClick={saveFallback}
            className="rounded-md border border-arcane-500/60 bg-arcane-600/30 px-3 py-2 text-sm text-parchment-100 hover:bg-arcane-500/40 disabled:opacity-50"
          >
            Save fallback
          </button>
          {settings?.fallback.hasUserKey ? (
            <button
              type="button"
              disabled={requestPending}
              onClick={clear}
              className="rounded-md border border-blood-500/40 bg-blood-600/20 px-3 py-2 text-sm text-blood-500 hover:bg-blood-600/30 disabled:opacity-50"
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
