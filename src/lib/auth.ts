/**
 * Authelia ForwardAuth integration.
 *
 * Traefik calls Authelia for every protected request and, on success,
 * injects identity headers (Remote-User, Remote-Email, Remote-Groups, Remote-Name)
 * into the upstream request to Next.js.
 *
 * This module:
 *   - reads those headers from `next/headers`
 *   - upserts a corresponding User row on first sight (just-in-time provisioning)
 *   - flips the `isDM` flag based on group membership
 *
 * Two auth modes coexist in this app:
 *   1. Authelia-protected routes (DM + authenticated players) → getSessionUser()
 *   2. Invite-token routes (/play/invite/<code>) → see lib/invite.ts;
 *      bypasses Authelia via Traefik routing rules.
 */

import { headers } from "next/headers";
import { cache } from "react";
import { prisma } from "./db";
import { env } from "./env";

export type SessionUser = {
  id: string;
  username: string;
  email: string | null;
  name: string | null;
  isDM: boolean;
  source: "authelia" | "invite";
};

/** Read identity from Authelia-injected headers.  Returns null if absent.
 *  In development, falls back to a DEV_AUTH_USER env var so the app is usable
 *  without Authelia in front. */
async function readAutheliaHeaders() {
  const h = await headers();
  const e = env();

  let username =
    h.get(e.AUTHELIA_HEADER_USER) ??
    h.get(e.AUTHELIA_HEADER_USER.toLowerCase());
  let email =
    h.get(e.AUTHELIA_HEADER_EMAIL) ??
    h.get(e.AUTHELIA_HEADER_EMAIL.toLowerCase());
  let name =
    h.get(e.AUTHELIA_HEADER_NAME) ??
    h.get(e.AUTHELIA_HEADER_NAME.toLowerCase());
  let groupsRaw =
    h.get(e.AUTHELIA_HEADER_GROUPS) ??
    h.get(e.AUTHELIA_HEADER_GROUPS.toLowerCase());

  // Dev fallback — only when NODE_ENV=development AND DEV_AUTH_USER is set.
  if (
    !username &&
    process.env.NODE_ENV === "development" &&
    process.env.DEV_AUTH_USER
  ) {
    username = process.env.DEV_AUTH_USER;
    email = process.env.DEV_AUTH_EMAIL ?? `${username}@local.dev`;
    name = process.env.DEV_AUTH_NAME ?? username;
    groupsRaw = process.env.DEV_AUTH_GROUPS ?? e.AUTHELIA_DM_GROUP;
  }

  if (!username) return null;

  const groups = (groupsRaw ?? "")
    .split(",")
    .map((g) => g.trim())
    .filter(Boolean);

  return {
    username,
    email: email && email.length > 0 ? email : null,
    name: name && name.length > 0 ? name : null,
    groups,
    isDM: groups.includes(e.AUTHELIA_DM_GROUP),
  };
}

/** Return the currently-authenticated user (Authelia), provisioning if needed.
 *  Cached per-request via React's `cache`. */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const ident = await readAutheliaHeaders();
  if (!ident) return null;

  const user = await prisma.user.upsert({
    where: { username: ident.username },
    update: {
      email: ident.email ?? undefined,
      displayName: ident.name ?? undefined,
      isDM: ident.isDM,
      lastSeenAt: new Date(),
    },
    create: {
      username: ident.username,
      email: ident.email,
      displayName: ident.name,
      isDM: ident.isDM,
    },
  });

  return {
    id: user.id,
    username: user.username,
    email: user.email,
    name: user.displayName,
    isDM: user.isDM,
    source: "authelia",
  };
});

/** Throw or redirect if no Authelia session.  For server actions / API routes. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new AuthError("UNAUTHENTICATED");
  return user;
}

export async function requireDM(): Promise<SessionUser> {
  const user = await requireUser();
  if (!user.isDM) throw new AuthError("FORBIDDEN_NOT_DM");
  return user;
}

export class AuthError extends Error {
  constructor(public code: "UNAUTHENTICATED" | "FORBIDDEN_NOT_DM") {
    super(code);
    this.name = "AuthError";
  }
}
