export type TtsAccess =
  | { kind: "invite"; token: string }
  | { kind: "display"; token: string };

export function ttsPostPath(sessionId: string, access?: TtsAccess) {
  const encodedSession = encodeURIComponent(sessionId);
  if (access?.kind === "invite") {
    return `/api/invite/sessions/${encodedSession}/tts/${encodeURIComponent(
      access.token,
    )}`;
  }
  if (access?.kind === "display") {
    return `/api/display/sessions/${encodedSession}/tts/${encodeURIComponent(
      access.token,
    )}`;
  }
  return `/api/sessions/${encodedSession}/tts`;
}
