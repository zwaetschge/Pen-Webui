# Console Casting Implementation Plan

1. Add failing tests for display capability tokens and the host cast API.
2. Implement the token module, Unix-socket cast client, host routes, and display
   page/stream routes.
3. Add the PyChromecast agent image and Compose host-network/socket wiring.
4. Replace the browser instruction dialog with live server device controls.
5. Add a read-only display experience and reshape the table header into a console
   command rail; refine the phone controller presentation.
6. Advance the bootstrap version and harden opening prose migration/filtering.
7. Ensure replay includes the latest bootstrap for newly connected TV screens.
8. Run focused tests, Python tests, lint, typecheck, full Vitest, build, Compose
   validation, then desktop/mobile/TV browser checks.
9. Publish the branch to GitHub, verify CI, deploy with a database backup, and
   perform a real Chromecast discovery/start/stop smoke test when a device is
   available.
