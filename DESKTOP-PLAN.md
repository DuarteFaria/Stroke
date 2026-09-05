# Stroke desktop delivery

Agreed direction: Windows-first local desktop app, Electron shell, existing React editor and Python/MediaPipe analyzer. Videos remain local; no accounts or cloud hosting.

## Implementation checklist
- [x] Dedicated window, icon, version, loading/error states.
- [x] Production frontend assets, no development server required.
- [x] Automatic private analyzer startup, readiness, cancellation and shutdown.
- [x] Bundled Python/native dependencies and pose model.
- [x] Native project Open/Save, remembered video locations.
- [x] Automatic recovery snapshots and unsaved-close protection.
- [x] Single-instance behavior and exportable diagnostic logs.
- [x] Windows installer with pinned build dependencies.
- [x] Validate unit tests, production builds, packaged startup and real inference.
- [ ] External release gate: clean Windows machine, slower hardware, actual tester footage; signing credentials if a signed release is required.

## Validation on 2026-09-05

Windows x64 installer built (approximately 209 MB / 199 MiB). Packaged application passed 12 integration checks, using its bundled analyzer: rendering, token enforcement, origin rejection, project open, video open/decoding, real inference, save to an opened project, saved notes/tracking, remembered-video reopen, recovery roundtrip, cancelled save and Save As. OS dialog responses were automated. Real inference found the athlete in 38/38 samples of the supplied 2.5-second segment. Analyzer exited cleanly and its temporary video directory was empty afterward.

Six frontend and ten backend unit tests passed. Typecheck, lint, browser production build and desktop production build passed. The executable is unsigned. Clean-machine installation, slower hardware and human review of OS dialogs remain external tester checks, not completed validations.

## Deferred
macOS/Linux installers, automatic updates, cloud projects, full account system and online analysis. Manual .stroke.json files remain portable; recovery does not replace explicit saving.
