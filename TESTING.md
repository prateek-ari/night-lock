# Night Lock testing

## Current validation status — 2026-10-01

**Acceptance is incomplete. Do not consider this a proven overnight release yet.** Testing was explicitly stopped at the user's request so they could use their PC. No further tests or nested desktop sessions should run until they request resumption.

| Check | Evidence / result |
|---|---|
| Host | Actual Ubuntu 24.04.5 LTS, GNOME Shell 46.0, GJS 1.80.2; current desktop X11 |
| Pure logic and actual controller with dependency fakes | 26 Node tests passed before testing stopped: schedule boundaries/DST, disable-tonight, motion jitter, wake token, redarken, pending entry/lock cancellation, startup/cleanup races, unsupported backend, guard/wake/unlock |
| GJS platform smoke | Passed on this PC: live read-only Mutter/ScreenSaver, notification default/explicit recovery in a memory settings backend, direct logind sleep inhibitor acquisition and immediate release while process stays alive |
| Real GNOME extension loading | Loaded and enabled in a separate nested GNOME 46 Wayland compositor on this Ubuntu host; GetStatus returned NORMAL/unlocked/automatic:true; no extension errors |
| Real extension enable/disable | Nested compositor: disable returned true, its private bus name disappeared, reenable returned true, GetExtensionErrors was empty |
| Preferences | Actual GTK4/libadwaita preferences rendered on this X11 host with isolated settings; both pages captured |
| Quick Settings | Actual moon icon and Night Lock tile rendered in the nested compositor; screenshot captured |
| Physical X11 monitor OFF/input/notification acceptance | **Pending**: newly installed extension requires the user's later Shell restart |
| Actual Wayland hardware session | **Pending**: nested Wayland is not equivalent to a physical Wayland session |
| Multi-monitor and physical hotplug | **Pending** |
| Eight-hour workload / configured automatic suspend | **Pending**; inhibitor acquisition alone doesn't prove full power-policy behavior |
| Final safety edits after tests stopped | Power-write coalescing, xset timeout/locale handling, forced-uninstall recovery waiting, startup-error lifetime gating, and cleanup ON gating received source review only; tests have not been rerun |

The isolated nested compositor was closed. No real desktop authentication was performed or bypassed, and no physical monitor-power test was performed. The extension is installed/enabled for the next GNOME startup; the current desktop has not loaded it yet. The ZIP and repository are a development snapshot, not an acceptance-tested stable release.

## Automated checks (when testing resumes)

```sh
npm test
./tests/run-gi-smoke.sh
./scripts/package.sh
```

Node tests execute the pure scheduling/movement/state modules plus the actual controller source with small GNOME dependency fakes. They do not substitute for compositor or hardware tests. The GJS smoke script requires `GSETTINGS_BACKEND=memory`, builds a temporary schema and uses Ubuntu's Mutter typelib/library paths. It never locks the session or requests display power changes, but briefly acquires/releases a sleep inhibitor. Notification writes stay in the memory backend.

Before accepting the latest safety changes, add/run a stalled-write test showing many queued OFF requests coalesce, ON supersedes pending OFF, cleanup failure preserves recovery, and uninstall never deletes uncleared recovery state. Check rejected/missing xset and no-DPMS backends. Verify disable/reenable while an old display write is in flight.

Preferences can be rendered independently of Shell for development:

```sh
glib-compile-schemas --strict night-lock@local/schemas
GI_TYPELIB_PATH=/usr/lib/gnome-shell/girepository-1.0 \
LD_LIBRARY_PATH=/usr/lib/gnome-shell GSETTINGS_BACKEND=memory \
gjs -m scripts/preview-prefs.js docs/screenshots/preferences.png docs/screenshots/wake-behaviour.png
```

That opens a real preferences window and saves actual GTK renderings. Don't run it or a nested desktop while the user needs the PC. `docs/screenshots/quick-settings.png` was captured from the real GNOME 46 control in an isolated nested compositor; no mockup or fabricated hardware test is presented.

## Live integration procedure

Use a convenient time with someone present to unlock GNOME. Keep a terminal available with `./scripts/night-lock cancel` and `./scripts/logs.sh`. Never ask an automation agent to type your password. Confirm the exact original notification values and X11 DPMS timeouts before the test and again afterwards. Use a camera or another person to observe physical monitor sleep; a screenshot or D-Bus OFF value alone is insufficient.

Start on this PC's **GNOME 46 X11** session. After `./install.sh`, at a convenient time press Alt+F2, type `r`, and Enter. Verify `gnome-extensions info night-lock@local` reports enabled with no errors, and the top-right moon/tile appears. On Wayland, log out/in instead. Check `./scripts/night-lock status` and preferences before trying any lock.

Temporarily adjust Night Lock's schedule in preferences for boundary checks rather than changing the system clock. Restore the original schedule afterwards. Ensure at least one approved wake source is enabled. Keep notification suppression, sleep inhibition and the display guard enabled for acceptance tests.

| # | Test | Required result | Result |
|---|---|---|---|
| 1 | Lock at 22:00, outside schedule | Ordinary Ubuntu lock; no Night Lock resources | Pending |
| 2 | Lock at 23:01 | Night Lock enters; all monitors physically sleep; inhibitor held | Pending |
| 3 | Lock at 22:59; schedule begins at 23:00 | Automatically engages while already locked | Pending |
| 4 | Desktop notification arrives while dark | No approved token; displays stay dark/reassert OFF | Pending |
| 5 | KDE Connect notification | Same; notification remains queued normally | Pending |
| 6 | Bluetooth connect/disconnect | No approved input/wake; remains dark | Pending |
| 7 | Wi-Fi reconnect | No approved input/wake; remains dark | Pending |
| 8 | USB device produces a notification | Remains dark; distinguish an actual input device emitting input | Pending |
| 9 | Press a physical keyboard key | Display ON, USER_WAKE; GNOME still requires normal authentication | Pending |
| 10 | Meaningful physical mouse motion | Wakes after configured accumulated threshold | Pending |
| 11 | Tiny optical-mouse jitter | No approved token; reassert OFF if X11 hardware lights briefly; record any flashes | Pending |
| 12 | Wake, then no unlock/interaction for 30 s | Returns to NIGHT_LOCKED/OFF without releasing inhibitor | Pending |
| 13 | Successfully unlock | Guard/input listeners removed, display ON, inhibitor released, exact notifications/DPMS restored | Pending |
| 14 | `sleep 8h` terminal workload | Still running before its intended completion; no suspend | Pending |
| 15 | Docker workload | Continues; Night Lock never kills or restarts it | Pending |
| 16 | Cross 07:00 while Night Locked | No spontaneous wake; stays active until unlock/cancel | Pending |
| 17 | Disable extension while active | Display ON; no inhibitor or suppressed preferences left | Pending |
| 18 | Connect second monitor while active | Global OFF reapplied; observe hardware hotplug flash separately | Pending |
| 19 | Original show-banners and/or lock notifications already false | Remain exactly false afterwards; inherited defaults remain inherited | Pending |
| 20 | Automatic suspend configured | logind inhibitor prevents routine suspend while active; no permanent power-setting change | Pending |

Repeat relevant cases with one and two displays, different pointer devices and a real Wayland login if available. Test monitor disconnect/reconnect, touchscreen disabled/enabled, and keyboard/touchpad/mouse switches independently. Confirm the physical source-device filter works on this PC; a device unsupported by the filter must fail without creating a token and be reported as an input-support issue.

Additional X11 tests: an external software DPMS ON while Mutter still reports OFF must be caught by the physical DPMS check; obvious XTEST/virtual injection must not mint a token; the original Standby/Suspend/Off timeouts must survive multiple wake/redarken cycles and cleanup. Record the real delay/any flash, rather than describing it as a zero-illumination guarantee.

Recovery checks: cancel while entry is pending; Shell disable/re-enable; stale state startup unlocked/locked after schedule end; forced recovery and uninstall; changed notification defaults; inhibitor rejection; power saving -1; failed display writes; many rejected-input events while the bus is slow. Any failed cleanup must leave a recovery record and avoid deleting the extension's files. A session crash test should be planned carefully, not performed on someone's working desktop without a suitable opportunity.

## Evidence to record

Record Ubuntu/Shell/GJS versions, X11/Wayland, monitor topology, original and restored settings, state changes, inhibitor presence/release, actual screen behavior and workload continuity. Logs must contain only event categories, never key codes, typed text, passwords or application content. Keep user-specific logs/private device information out of the public repository.

Only mark the project ready for unattended nightly use after completing the physical tests and addressing any observed wake or cleanup failures.
