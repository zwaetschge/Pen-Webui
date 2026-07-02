import { AuthError, requireDM } from "@/lib/auth";
import {
  subscribeTerminalSession,
  type TerminalEvent,
} from "@/lib/dm/terminal";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const encoder = new TextEncoder();

function encodeEvent(event: TerminalEvent) {
  return encoder.encode(
    `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
  );
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireDM();
    const { id } = await params;

    let cleanup: (() => void) | null = null;
    const stream = new ReadableStream({
      start(controller) {
        let closed = false;
        let unsubscribe: (() => void) | null = null;
        let keepalive: ReturnType<typeof setInterval> | null = null;

        const close = () => {
          if (closed) return;
          closed = true;
          if (keepalive) clearInterval(keepalive);
          unsubscribe?.();
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        };
        cleanup = close;

        const send = (event: TerminalEvent) => {
          if (closed) return;
          try {
            controller.enqueue(encodeEvent(event));
          } catch {
            close();
          }
        };

        unsubscribe = subscribeTerminalSession(id, user.id, (event) => {
          send(event);
        });

        if (!unsubscribe) {
          send({ type: "output", data: "terminal session not found\r\n" });
          send({ type: "exit", code: null, signal: null });
          close();
          return;
        }

        keepalive = setInterval(() => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(": ping\n\n"));
          } catch {
            close();
          }
        }, 15_000);

        req.signal.addEventListener(
          "abort",
          () => {
            close();
          },
          { once: true },
        );
      },
      cancel() {
        cleanup?.();
      },
    });

    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      },
    });
  } catch (e) {
    const status =
      e instanceof AuthError
        ? 401
        : e instanceof Error && e.message.includes("disabled")
          ? 403
          : 400;
    const msg = e instanceof Error ? e.message : "unknown";
    return new Response(JSON.stringify({ error: msg }), {
      status,
      headers: { "content-type": "application/json" },
    });
  }
}
