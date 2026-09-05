# Stroke — local kayak motion studio

**Windows desktop edition:** see [DESKTOP.md](DESKTOP.md) for the dedicated Electron app, installer build, native project dialogs, recovery and tester instructions. The browser workflow below remains available for development.

A first MVP for recorded sprint kayak footage. React/TypeScript (Vinext/Vite), Python/FastAPI and MediaPipe Pose. All video analysis happens on this computer; no account or cloud upload is used. The pose model is downloaded once during setup.

## Open the app

Run `Start-Stroke.ps1` from this folder. It starts both local services and opens http://127.0.0.1:3000/. `Stop-Stroke.ps1` stops the services started by that launcher. Logs are in `.local/`.

This computer is already set up. On a fresh Windows installation, use Python 3.12, Node 24 and pnpm 11, then run `Setup-Stroke.ps1`. The setup script also recognizes Codex's bundled runtimes. Python dependencies and the frontend lockfile are pinned. Internet is needed for initial setup only.

The interface is in European Portuguese; this file stays in English and quotes the
on-screen labels verbatim, so the walkthrough still matches what you see.

The four numbered steps across the top of the window show where you are: open a
video, pick the part, track the athlete, then review. A step lights up when it is
your turn, gets a tick once it is done, and clicking it takes you to the control
it describes.

## First useful exercise

1. Click **Abrir projeto** and choose `examples/first-stroke.stroke.json`.
2. Click **Escolher o vídeo original** and pick `videoplayback.mp4` in Downloads. A project stores your edits, not the footage, so the video has to be reconnected each time. This verifies its name, size, duration and dimensions; it is not a cryptographic content check.
3. The 16.4–18.9 second shot already contains automatic tracking. Play it slowly. Hollow points and dashed bones indicate low-confidence estimates; confidence does not establish accuracy.
4. Pause with **Corpo** selected and drag a dot to where the joint really is. Open **Ajuste fino** if you would rather pick the joint by name, place it with a click, or step it one pixel. Ctrl+Z and Ctrl+Y walk through the changes.
5. Under **Pá**, place Pagaia A and B and Referência 1 and 2. A placed point shows a tick on its button. Mark more frames to interpolate the annotation. Keep the A→B and 1→2 directions consistent.
6. Switch to **Ideal**, click **Criar movimento ideal** and adjust the orange skeleton. Replay the segment to compare it with the real one. Orange paddle points are editable too.
7. Mark catches and exits with **Ataque** and **Saída** after choosing the blade above them; they appear as ticks on the bar under the video. Save with **Guardar** or Ctrl+S, and retain the original video file.

For a new video, open it, drag the two pale handles on the bar under the video to
the part you want (or type the two numbers under **TRECHO**), and click **Detetar o
atleta**. When that button is unavailable, the line beside it says why. Keep one
athlete in view and select a continuous shot without cuts. Automatic selection of a
specific athlete among several is not implemented.

## Colour

The chrome is deliberately warm neutral and unsaturated. Saturated colour is
reserved for the data drawn over the video, and on the corrected skeleton each limb
carries its own hue: bone white torso, green left arm, cyan right arm, violet left
leg, magenta right leg. Crossing arms are exactly where the tracker fails, and one
flat colour used to hide it. Wrist trails inherit their arm's colour. Around that,
orange is the proposed movement, yellow the paddle, dim grey the untouched estimate.

## Reading the bar under the video

- The green band marks the frames that actually carry tracking.
- The shaded box between the two pale handles is the part that will be analysed.
- Catches hang from the bottom edge, exits from the top, so they read without relying on colour; the white line is the playhead.
- Away from the analysed part the skeleton disappears, and the video says so rather than looking broken.

## Messages

Confirmations appear as a toast in the bottom corner and clear themselves after a
few seconds. Anything that needs a decision — a file that is too big, an analyzer
that will not answer — stays until it is read and dismissed with its × or Escape.
Nothing is left sitting on screen after it stops being true.

## On a desktop

At 1200 px wide and 760 px tall or more the app stops behaving like a page and
fills the window: the video takes whatever height the controls leave it, the tools
scroll in their own column, and the working loop of watch, pause, drag, read the
angles needs no scrolling at all. Below that threshold it falls back to ordinary
page flow.

## What works

- Local video selection, slow playback, nominal frame stepping, segment looping, keyboard playback/step controls. Space plays and pauses, ← and → step one frame, Ctrl+Z and Ctrl+Y undo and redo, Ctrl+S saves; the same list sits behind the keyboard icon in the transport row.
- Background pose tracking with progress and cancellation; temporary video copies are deleted after completion/cancellation/error. Job results expire after an hour when subsequent analyses start.
- Immutable raw tracking, separate joint corrections and target offsets, 30-step undo/redo for edits.
- Per-joint local corrections blend over approximately ±0.2 seconds for isolated edits. Nearby corrections can join into longer interpolated spans.
- Target offsets interpolate between keys and hold at their endpoints. Changes to the corrected baseline also affect its target.
- Manual paddle/reference annotations interpolate between keyframes only; outside that interval they are shown only within 0.04 seconds of a key. The paddle is not automatically tracked.
- Image-plane elbow/knee angles and a directed 0–180° shaft/reference angle. Geometry accounts for video aspect ratio. Uncertain or degenerate joint angles are withheld.
- Wrist trails, catch/exit timestamps, notes and versioned `.stroke.json` export/import. Videos are not embedded in project files. There is no automatic save; use **Guardar** before closing. Accented project names are transliterated for the exported filename.

## Limits to understand

- This is a tracking/editor prototype, not validated biomechanics or an automatic coaching verdict. Occluded hips/legs, crossing arms, loose clothing and camera cuts can produce wrong points even with high confidence.
- No complete pose in a frame means no editable skeleton there. Nearby successful samples are interpolated only across short gaps with detections at both ends. Manual reconstruction of an entirely missing pose is a later improvement.
- Tracking samples at up to 15 fps for a responsive CPU workflow. Original video playback is preserved. Frame stepping uses reported average FPS (assumed 30 until analysis); variable-frame-rate sources are approximate. Event times use video playback time, not a recovered capture time. Edited slow motion is unsuitable for physical stroke timing unless calibrated externally.
- Upload limit: 1 GB. Analysis segment limit: 120 seconds. These are MVP resource limits, not accuracy thresholds.
- Measurements are 2D projections. No true 3D rotation, force, speed prediction, centimetre calibration, automatic catch/exit detection or automatic paddle tracking.
- The target is a free 2D sketch. Limb lengths and hand/paddle contact are not constrained. It does not automatically rewrite the video or produce a rendered video export.
- Live ergometer input, synchronized cameras and 3D editing are later milestones.

## Development and validation

- Frontend: from `app`, `pnpm dev`, `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm test`.
- Backend: `.venv/Scripts/python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8766`.
- Backend tests: `.venv/Scripts/python.exe -m pytest tests -q`.
- Lint targets authored application/library/test files. Unmodified generated Shadcn components have separate pre-existing lint violations and are not rewritten by this project.
- Geometry/interpolation/project validation and backend validation/cancellation tests are included. Real inference was exercised on both supplied videos, and sample overlays were inspected.
- Browser QA has been performed for project import, video reconnection, the segment handles and their undo grouping, joint dragging and nudging, paddle placement, target creation, catch/exit marking, the mode switch, the fine-tuning drawer, toast dismissal and expiry, the confirmation dialog, and layout from 375 px up to 1920 x 1080. A full analysis run has not been driven from the browser; it was exercised through the backend directly.
- Interface strings, joint names, the default project name and the sample project's own name and notes are European Portuguese. The optional WebMCP tool description stays in English, since it is read by software rather than by a person.
- The optional, feature-detected `get_stroke_session` WebMCP read tool is not browser-verified. Unsupported browsers simply omit it.

Files: `app/app/Studio.tsx` is the editor, `app/lib/motion.ts` holds geometry and project logic, and `backend/main.py` handles local inference.
