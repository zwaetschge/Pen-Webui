export function ttsPostPath(sessionId: string, inviteToken?: string) {
  return inviteToken
    ? `/api/invite/sessions/${encodeURIComponent(sessionId)}/tts/${encodeURIComponent(
        inviteToken,
      )}`
    : `/api/sessions/${encodeURIComponent(sessionId)}/tts`;
}
