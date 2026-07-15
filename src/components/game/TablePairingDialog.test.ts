import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PAIRING_POLL_INTERVAL_MS,
  pairingSeatNameClassName,
  pairingSeatPresentation,
  startPairingPolling,
} from "./TablePairingDialog";

describe("pairingSeatPresentation", () => {
  it("describes claimed seats as assigned without claiming the device is online", () => {
    expect(pairingSeatPresentation("paired")).toEqual({
      statusLabel: "Zugewiesen",
      panelTitle: "Charakter zugewiesen",
      panelBody:
        "Dieser Zugriffscode wurde bereits einem Gerät zugewiesen. Ob es gerade online ist, wird nicht überwacht.",
    });
  });

  it("keeps unclaimed seats ready to scan", () => {
    expect(pairingSeatPresentation("ready").statusLabel).toBe(
      "Bereit zum Scannen",
    );
  });
});

describe("pairing seat layout", () => {
  it("reserves space for the seat number beside long character names", () => {
    const className = pairingSeatNameClassName();

    expect(className).toContain("pr-12");
    expect(className).toContain("truncate");
  });
});

describe("startPairingPolling", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("polls sequentially at the configured interval and stops cleanly", async () => {
    vi.useFakeTimers();
    const poll = vi.fn().mockResolvedValue(undefined);

    const stop = startPairingPolling(poll);

    await vi.advanceTimersByTimeAsync(PAIRING_POLL_INTERVAL_MS - 1);
    expect(poll).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(poll).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(PAIRING_POLL_INTERVAL_MS);
    expect(poll).toHaveBeenCalledTimes(2);

    stop();
    await vi.advanceTimersByTimeAsync(PAIRING_POLL_INTERVAL_MS * 2);
    expect(poll).toHaveBeenCalledTimes(2);
  });
});
