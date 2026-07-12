import { expect, it, vi } from "vitest";
import { claimInviteRedirect } from "./AutoClaimInvite";

it("claims once with POST and returns the server redirect", async () => {
  const request = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ redirectTo: "/play/invite/code/sessions/a" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );

  const redirect = await claimInviteRedirect("session a", "token/value", request);

  expect(request).toHaveBeenCalledTimes(1);
  expect(request).toHaveBeenCalledWith(
    "/api/invite/sessions/session%20a/claim/token%2Fvalue",
    { method: "POST", credentials: "same-origin" },
  );
  expect(redirect).toBe("/play/invite/code/sessions/a");
});

it("returns null when the seat is unavailable", async () => {
  const request = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ error: "invite_unavailable" }), {
      status: 409,
      headers: { "content-type": "application/json" },
    }),
  );

  await expect(
    claimInviteRedirect("session-a", "token-a", request),
  ).resolves.toBeNull();
});
