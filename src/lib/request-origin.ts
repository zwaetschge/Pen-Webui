/**
 * Validate a browser mutation against the public request origin.
 *
 * Next's internal request URL may contain the container bind address. Behind a
 * trusted reverse proxy, Host/X-Forwarded-* are therefore the canonical public
 * origin used by the browser.
 */
export function isSameOriginMutation(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;

  const requestUrl = new URL(request.url);
  const forwardedHost = firstHeaderValue(
    request.headers.get("x-forwarded-host"),
  );
  const host = forwardedHost ?? request.headers.get("host");
  const forwardedProto = firstHeaderValue(
    request.headers.get("x-forwarded-proto"),
  );
  const protocol = forwardedProto ?? requestUrl.protocol.replace(/:$/, "");

  try {
    const expected = host
      ? new URL(`${protocol}://${host}`).origin
      : requestUrl.origin;
    return new URL(origin).origin === expected;
  } catch {
    return false;
  }
}

function firstHeaderValue(value: string | null) {
  const first = value?.split(",", 1)[0]?.trim();
  return first || null;
}
