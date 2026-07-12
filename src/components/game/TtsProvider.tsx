"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ttsPostPath } from "./tts-paths";

type PlaybackStatus = "idle" | "loading" | "playing" | "error";

type TtsContextValue = {
  activeEventId: string | null;
  statusByEventId: Record<string, PlaybackStatus>;
  autoplay: boolean;
  setAutoplay: (value: boolean) => void;
  play: (eventId: string) => Promise<void>;
  stop: () => void;
  toggle: (eventId: string) => Promise<void>;
};

type TtsProviderProps = {
  sessionId: string;
  inviteToken?: string;
  enabled?: boolean;
  children: ReactNode;
};

type ActivePlayback = {
  audio: HTMLAudioElement;
  eventId: string;
  requestId: number;
};

const TtsContext = createContext<TtsContextValue | null>(null);
const AUTOPLAY_KEY = "plum.tts.autoplay.v1";

export function TtsProvider({
  sessionId,
  inviteToken,
  enabled = true,
  children,
}: TtsProviderProps) {
  const playbackRef = useRef<ActivePlayback | null>(null);
  const requestIdRef = useRef(0);
  const activeEventIdRef = useRef<string | null>(null);
  const [activeEventId, setActiveEventId] = useState<string | null>(null);
  const [statusByEventId, setStatusByEventId] = useState<
    Record<string, PlaybackStatus>
  >({});
  const [autoplay, setAutoplayState] = useState(false);

  const setEventStatus = useCallback(
    (eventId: string, status: PlaybackStatus) => {
      setStatusByEventId((state) =>
        state[eventId] === status ? state : { ...state, [eventId]: status },
      );
    },
    [],
  );

  const setActiveEvent = useCallback((eventId: string | null) => {
    activeEventIdRef.current = eventId;
    setActiveEventId(eventId);
  }, []);

  const disposePlayback = useCallback(
    (status: PlaybackStatus) => {
      const current = playbackRef.current;
      if (!current) return false;

      current.audio.onended = null;
      current.audio.onerror = null;
      current.audio.pause();
      playbackRef.current = null;
      setEventStatus(current.eventId, status);
      return true;
    },
    [setEventStatus],
  );

  useEffect(() => {
    setAutoplayState(
      enabled && window.localStorage.getItem(AUTOPLAY_KEY) === "true",
    );
  }, [enabled]);

  useEffect(
    () => () => {
      requestIdRef.current += 1;
      const current = playbackRef.current;
      if (!current) return;
      current.audio.onended = null;
      current.audio.onerror = null;
      current.audio.pause();
      playbackRef.current = null;
    },
    [],
  );

  const setAutoplay = useCallback((value: boolean) => {
    if (!enabled) return;
    setAutoplayState(value);
    window.localStorage.setItem(AUTOPLAY_KEY, value ? "true" : "false");
  }, [enabled]);

  const stop = useCallback(() => {
    requestIdRef.current += 1;
    const activeId = activeEventIdRef.current;
    const hadAudio = disposePlayback("idle");
    if (!hadAudio && activeId) {
      setEventStatus(activeId, "idle");
    }
    setActiveEvent(null);
  }, [disposePlayback, setActiveEvent, setEventStatus]);

  const play = useCallback(
    async (eventId: string) => {
      if (!enabled) return;
      requestIdRef.current += 1;
      const requestId = requestIdRef.current;
      const previousActiveId = activeEventIdRef.current;

      disposePlayback("idle");
      if (previousActiveId && previousActiveId !== eventId) {
        setEventStatus(previousActiveId, "idle");
      }

      setActiveEvent(eventId);
      setEventStatus(eventId, "loading");

      try {
        const response = await fetch(ttsPostPath(sessionId, inviteToken), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ eventId }),
        });
        if (requestIdRef.current !== requestId) return;
        if (!response.ok) throw new Error("tts_failed");

        const body = (await response.json().catch(() => null)) as
          | { audioUrl?: unknown }
          | null;
        if (!body || typeof body.audioUrl !== "string" || body.audioUrl === "") {
          throw new Error("tts_failed");
        }
        if (requestIdRef.current !== requestId) return;

        const audio = new Audio(body.audioUrl);
        audio.preload = "auto";
        audio.onended = () => {
          if (requestIdRef.current !== requestId) return;
          playbackRef.current = null;
          setEventStatus(eventId, "idle");
          setActiveEvent(null);
        };
        audio.onerror = () => {
          if (requestIdRef.current !== requestId) return;
          playbackRef.current = null;
          setEventStatus(eventId, "error");
          setActiveEvent(null);
        };

        playbackRef.current = { audio, eventId, requestId };
        await audio.play();
        if (requestIdRef.current !== requestId) {
          audio.pause();
          audio.onended = null;
          audio.onerror = null;
          if (
            playbackRef.current?.eventId === eventId &&
            playbackRef.current.requestId === requestId
          ) {
            playbackRef.current = null;
          }
          return;
        }

        setEventStatus(eventId, "playing");
      } catch {
        if (requestIdRef.current !== requestId) return;

        const current = playbackRef.current;
        if (current?.eventId === eventId && current.requestId === requestId) {
          current.audio.onended = null;
          current.audio.onerror = null;
          current.audio.pause();
          playbackRef.current = null;
        }

        setEventStatus(eventId, "error");
        setActiveEvent(null);
      }
    },
    [disposePlayback, enabled, inviteToken, sessionId, setActiveEvent, setEventStatus],
  );

  const toggle = useCallback(
    async (eventId: string) => {
      if (activeEventIdRef.current === eventId) {
        stop();
        return;
      }
      await play(eventId);
    },
    [play, stop],
  );

  const value = useMemo<TtsContextValue>(
    () => ({
      activeEventId,
      statusByEventId,
      autoplay,
      setAutoplay,
      play,
      stop,
      toggle,
    }),
    [activeEventId, autoplay, play, setAutoplay, statusByEventId, stop, toggle],
  );

  return <TtsContext.Provider value={value}>{children}</TtsContext.Provider>;
}

export function isTtsExperienceEnabled(experience: "table" | "companion") {
  return experience === "table";
}

export function useTtsPlayback() {
  const context = useContext(TtsContext);
  if (!context) {
    throw new Error("useTtsPlayback must be used inside TtsProvider");
  }
  return context;
}
