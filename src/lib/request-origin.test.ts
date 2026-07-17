import { describe, expect, it } from "vitest";
import { isSameOriginMutation } from "./request-origin";

describe("isSameOriginMutation", () => {
  it("accepts matching direct and reverse-proxy origins", () => {
    expect(
      isSameOriginMutation(
        new Request("https://table.example/api/action", {
          headers: { origin: "https://table.example" },
        }),
      ),
    ).toBe(true);

    expect(
      isSameOriginMutation(
        new Request("http://0.0.0.0:3000/api/action", {
          headers: {
            host: "table.example",
            origin: "https://table.example",
            "x-forwarded-host": "table.example",
            "x-forwarded-proto": "https",
          },
        }),
      ),
    ).toBe(true);
  });

  it("rejects cross-origin and malformed browser origins", () => {
    const target = "http://0.0.0.0:3000/api/action";
    const proxyHeaders = {
      host: "table.example",
      "x-forwarded-host": "table.example",
      "x-forwarded-proto": "https",
    };

    expect(
      isSameOriginMutation(
        new Request(target, {
          headers: { ...proxyHeaders, origin: "https://attacker.example" },
        }),
      ),
    ).toBe(false);
    expect(
      isSameOriginMutation(
        new Request(target, {
          headers: { ...proxyHeaders, origin: "null" },
        }),
      ),
    ).toBe(false);
  });

  it("allows non-browser callers without an Origin header", () => {
    expect(
      isSameOriginMutation(new Request("https://table.example/api/action")),
    ).toBe(true);
  });
});
