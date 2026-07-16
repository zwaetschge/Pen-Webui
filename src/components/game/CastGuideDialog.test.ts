import { describe, expect, it } from "vitest";
import {
  castDevicePresentation,
  castDialogBodyClassName,
  castDialogPanelClassName,
  castErrorMessage,
  castPendingActionLabel,
  castServicePresentation,
} from "./CastGuideDialog";

describe("server-side cast console", () => {
  it("presents a free Chromecast as a start target", () => {
    expect(
      castDevicePresentation({ active: false, busy: false, online: true }),
    ).toEqual({
      status: "Bereit",
      action: "Auf diesem TV starten",
      disabled: false,
    });
  });

  it("presents active and busy devices without ambiguous controls", () => {
    expect(
      castDevicePresentation({ active: true, busy: false, online: true }),
    ).toMatchObject({ status: "Dieser Tisch läuft", action: "Beenden" });
    expect(
      castDevicePresentation({ active: false, busy: true, online: true }),
    ).toMatchObject({ status: "Anderer Tisch aktiv", disabled: true });
  });

  it("translates agent failures into useful German copy", () => {
    expect(castErrorMessage("cast_agent_unavailable")).toContain("Cast-Dienst");
    expect(castErrorMessage("device_not_found")).toContain("nicht mehr");
  });

  it("shows an explicit checking state before the agent answers", () => {
    expect(castServicePresentation("checking")).toMatchObject({
      label: "Dienst wird geprüft",
      liveStatus: "Cast-Dienst wird geprüft.",
    });
    expect(castServicePresentation("online").label).toBe("Dienst online");
    expect(castServicePresentation("offline").label).toBe("Dienst offline");
  });

  it("uses the correct pending copy for starting and stopping", () => {
    expect(castPendingActionLabel(false)).toBe("Wird verbunden…");
    expect(castPendingActionLabel(true)).toBe("Wird beendet…");
  });

  it("keeps the console usable when the viewport or text is enlarged", () => {
    expect(castDialogPanelClassName()).toContain("max-h-");
    expect(castDialogPanelClassName()).toContain("flex-col");
    expect(castDialogBodyClassName()).toContain("overflow-y-auto");
    expect(castDialogBodyClassName()).toContain("min-h-0");
  });
});
