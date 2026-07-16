import { createHash } from "node:crypto";
import { request } from "node:http";
import { z } from "zod";

const MAX_RESPONSE_BYTES = 1024 * 1024;

const deviceSchema = z.object({
  id: z.string().min(1).max(160),
  name: z.string().min(1).max(160),
  model: z.string().min(1).max(160),
  online: z.boolean(),
  activeSessionId: z.string().max(160).nullable(),
});

const devicesSchema = z.object({ devices: z.array(deviceSchema).max(64) });
const castSchema = z.object({
  cast: z.object({
    state: z.enum(["starting", "stopped"]),
    deviceId: z.string().min(1).max(160),
    deviceName: z.string().max(160).optional(),
    sessionId: z.string().max(160).optional(),
  }),
});

export type CastAgentDevice = z.infer<typeof deviceSchema>;

export type CastAgentTransportInput = {
  socketPath: string;
  method: "GET" | "POST" | "DELETE";
  path: string;
  authToken: string;
  body?: Record<string, unknown>;
  timeoutMs: number;
};

export type CastAgentTransport = (
  input: CastAgentTransportInput,
) => Promise<unknown>;

export class CastAgentError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    options?: { cause?: unknown },
  ) {
    super(code, options);
    this.name = "CastAgentError";
  }
}

export function castAgentAuthToken(secret: string) {
  return createHash("sha256")
    .update("plum-cast-agent:v1\0", "utf8")
    .update(secret, "utf8")
    .digest("hex");
}

export function createCastAgentClient(input: {
  socketPath: string;
  secret: string;
  transport?: CastAgentTransport;
  timeoutMs?: number;
}) {
  const transport = input.transport ?? unixJsonTransport;
  const timeoutMs = input.timeoutMs ?? 12_000;
  const base = {
    socketPath: input.socketPath,
    authToken: castAgentAuthToken(input.secret),
    timeoutMs,
  };

  return {
    async listDevices(): Promise<CastAgentDevice[]> {
      const raw = await transport({
        ...base,
        method: "GET",
        path: "/v1/devices",
      });
      const parsed = devicesSchema.safeParse(raw);
      if (!parsed.success) throw new CastAgentError("invalid_response", 502);
      return parsed.data.devices;
    },

    async startCast(body: {
      sessionId: string;
      deviceId: string;
      url: string;
    }) {
      const raw = await transport({
        ...base,
        method: "POST",
        path: "/v1/casts",
        body,
      });
      const parsed = castSchema.safeParse(raw);
      if (!parsed.success) throw new CastAgentError("invalid_response", 502);
      return parsed.data.cast;
    },

    async stopCast(body: { sessionId: string; deviceId: string }) {
      const path = `/v1/casts/${encodeURIComponent(body.deviceId)}?sessionId=${encodeURIComponent(body.sessionId)}`;
      const raw = await transport({ ...base, method: "DELETE", path });
      const parsed = castSchema.safeParse(raw);
      if (!parsed.success) throw new CastAgentError("invalid_response", 502);
      return parsed.data.cast;
    },
  };
}

export const unixJsonTransport: CastAgentTransport = (input) =>
  new Promise((resolve, reject) => {
    const payload = input.body
      ? Buffer.from(JSON.stringify(input.body), "utf8")
      : null;
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };

    const req = request(
      {
        socketPath: input.socketPath,
        path: input.path,
        method: input.method,
        headers: {
          authorization: `Bearer ${input.authToken}`,
          accept: "application/json",
          ...(payload
            ? {
                "content-type": "application/json",
                "content-length": String(payload.byteLength),
              }
            : {}),
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        let received = 0;
        response.on("data", (chunk: Buffer) => {
          received += chunk.byteLength;
          if (received > MAX_RESPONSE_BYTES) {
            req.destroy(new Error("response_too_large"));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => {
          let body: unknown = null;
          try {
            const text = Buffer.concat(chunks).toString("utf8");
            body = text ? JSON.parse(text) : null;
          } catch (error) {
            finish(() =>
              reject(
                new CastAgentError("invalid_response", 502, { cause: error }),
              ),
            );
            return;
          }

          const status = response.statusCode ?? 500;
          if (status < 200 || status >= 300) {
            const code =
              body &&
              typeof body === "object" &&
              "error" in body &&
              typeof (body as { error?: unknown }).error === "string"
                ? (body as { error: string }).error
                : "cast_agent_error";
            finish(() => reject(new CastAgentError(code, status)));
            return;
          }
          finish(() => resolve(body));
        });
      },
    );

    const timer = setTimeout(() => {
      req.destroy(new Error("cast_agent_timeout"));
    }, input.timeoutMs);
    timer.unref?.();

    req.on("error", (error) => {
      const code =
        error instanceof Error && error.message === "cast_agent_timeout"
          ? "cast_agent_timeout"
          : "cast_agent_unavailable";
      finish(() =>
        reject(
          new CastAgentError(code, code.endsWith("timeout") ? 504 : 503, {
            cause: error,
          }),
        ),
      );
    });
    if (payload) req.write(payload);
    req.end();
  });
