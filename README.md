# Easy as Tuning

A precision chromatic and instrument tuner for guitar, bass, ukulele, banjo,
mandolin and orchestral strings. One codebase runs on Windows, Android and
iPhone.

Pitch detection is accurate to **better than a tenth of a cent** on a clean
signal (see [Accuracy](#accuracy)). All analysis happens on-device — no
account, no network, no recording.

---

## Quick start (Windows)

```bash
npm install
```

```bash
npm run dev
```

Open <http://localhost:5440> and press the power button in the middle of the
tuner. `localhost` counts as a secure context, so the microphone works without
any certificate setup.

## Running it on your phone

Browsers only hand over a microphone over HTTPS, so the plain dev server won't
work from a phone. Build it and serve the build over HTTPS:

```bash
npm run phone
```

Vite prints a `https://192.168.x.x:4440` address. Open that on your phone,
accept the self-signed-certificate warning once, and you're in. Phone and PC
must be on the same Wi-Fi.

`npm run host` puts the *dev* server on your LAN instead. It is rarely what you
want on a phone: dev mode ships every source file as its own module request,
which is hundreds of them over a self-signed certificate, and Safari tends to
stall partway and leave you a white screen.

Both ports are deliberately off Vite's defaults of 5173 and 4173. A browser
keys service workers and storage by origin — scheme, host and port — so two
projects on the default ports, reached at the same LAN address, are one origin
to your phone and will serve each other's apps.

To keep it on your home screen as a real app:

- **Android / Chrome** — menu → *Add to Home screen* (or the install prompt).
- **iPhone / Safari** — Share → *Add to Home Screen*. It then launches
  full-screen with no browser chrome.

Installed, it works offline: a service worker caches the whole app.

## Building native App Store / Play Store apps

The project is Capacitor-ready. Native builds need the platform toolchains
(Android Studio for Android; Xcode on a Mac for iOS):

```bash
npm install @capacitor/core @capacitor/cli @capacitor/android @capacitor/ios
```

```bash
npm run build && npx cap add android && npx cap open android
```

`capacitor.config.json` is already set up (`webDir: dist`). Two things to add in
the native projects, since both platforms gate microphone access:

- **Android** — add to `android/app/src/main/AndroidManifest.xml`:
  `<uses-permission android:name="android.permission.RECORD_AUDIO" />`
- **iOS** — add to `ios/App/App/Info.plist`:
  `NSMicrophoneUsageDescription` with a sentence such as
  *"Easy as Tuning listens to your instrument to show its pitch."*

Thereafter `npm run cap:android` / `npm run cap:ios` rebuild and sync.

---

## Features

**Tuning**

- 91 built-in tunings across guitar, bass, ukulele, banjo, orchestral strings
  and others (mandolin, bouzouki, dobro, lap steel, oud, cavaquinho…)
- Chromatic mode for anything not in the list
- **Auto** mode detects which string you're playing; manual mode locks to one
- Recent, Favourites and Popular sections, plus search across names,
  instruments and note spellings
- Custom tuning editor — any number of strings from 2 to 12, any notes,
  saved to your device
- Auto-advance to the next untuned string, and a green check per string

**Precision**

- Reference pitch adjustable 415–466 Hz (A442 orchestras, A415 baroque)
- In-tune window selectable at ±2, ±3, ±5 or ±10 cents
- Capo compensation, 0–12 frets
- Sharps, flats or solfège note naming

**The display**

- A note carousel across the top: the note being tuned sits in the middle at
  full size, with its two chromatic neighbours either side shrinking and
  dimming outward. Read-only
- A square field looking onto a world that scrolls steadily downward. The
  marker is pinned vertically and only ever moves left and right, so the
  falling background reads as the marker climbing
- The trail drops away beneath it at exactly the background's rate, leaving a
  legible few seconds of history of where the pitch has been — and carrying the
  color it had at the time, so tuning up leaves an amber-to-green streak. It is
  stroked opaque into an offscreen buffer and faded once through a gradient
  mask, so crossing back over itself never shows as a denser patch
- The marker is an inverted nib: rounded across the crown, with both lower
  edges curving inward to taper to a hairline at the tip. The cent offset rides
  just above it and travels with it
- Semitone gridlines are labelled with the notes they actually are, so a string
  sitting a semitone sharp of D reads as landing on D♯ rather than as "+1"
- Green inside the in-tune window, white out to half a semitone, amber beyond
- Flat to the left, sharp to the right, ±250 cents edge to edge
- Tuning selector along the bottom of the screen, next to the Auto toggle

**Everything else**

- Reference tones — tap a string to hear the note you're aiming for
- Optional confirmation chime and vibration when a string lands
- Dark / light / follow-system themes
- Left-handed string order
- Input device picker and a sensitivity control for noisy rooms
- Keeps the screen awake while tuning
- Releases the microphone as soon as you switch away

---

## Accuracy

`npm test` runs the detector against synthetic instrument signals at known
frequencies:

```bash
npm test
```

Measured worst case across the full instrument range (B0 at 30.87 Hz through
E6 at 1318 Hz), including plucked-decay envelopes, added room noise and mic
rumble:

| Test | Result |
| --- | --- |
| Clean tones, B0 → E6 | worst error **0.43 cents** (0.001–0.07 across the guitar/bass range) |
| Reported offset vs. real detuning, ±1…±49 cents | error **< 0.01 cents** |
| Plucked notes with decay, noise and rumble | error **< 0.07 cents** |
| Missing fundamental (octave trap) | correct octave, **< 0.01 cents** |
| Silence and white noise | correctly reports no pitch |
| Weak outliers a fourth away during decay | ignored; strong ones still followed |

### How it works

Pitch is found with the **McLeod Pitch Method**. MPM builds a Normalised Square
Difference Function and picks the *first* key maximum that reaches 90% of the
global maximum — the "first peak wins" rule is what stops it reporting an
octave up on harmonically rich sources like a plucked low E, which is the
classic failure of plain autocorrelation.

The autocorrelation term is computed with an FFT, so a 4096-sample window costs
well under a millisecond. Parabolic interpolation around the chosen peak gives
sub-sample period resolution, which is where the sub-cent accuracy comes from.

Raw detections then go through a stabiliser that works in the log-frequency
(cents) domain: a 5-frame median rejects single-frame outliers, an adaptive
glide snaps quickly to a new note but crawls once settled, each frame is
weighted by its own clarity, and an octave-jump guard requires three
consecutive confirmations before following a ±1200-cent leap.

The capture graph deliberately disables echo cancellation, noise suppression
and automatic gain control — all three are actively harmful to tuning accuracy.

### Following a note from pick to silence

A plucked note is not a steady tone, and most of a tuner's misbehaviour happens
at its two ends. The 4096-sample analysis window is ~85 ms long, which is long
enough to contain things you do not want it to.

**The attack.** For the first window-length after a pluck, the window still
contains the pick transient — broadband, inharmonic, with no stable period.
A fast envelope follower on a short 512-sample window (the main window smears
the attack away entirely) flags the onset, and the display is frozen until the
transient has scrolled out. Nothing is shown rather than something wrong, so
the point never jumps on the pick.

**The decay.** As a note fades, the window comes to hold more room noise and
sympathetic ringing from the *other* strings than the note that was played, and
a tuner that re-decides every frame will wander onto a string nobody touched.
Three things prevent that:

- the auto-detected string is **latched** on the first clean frame after a
  pluck and held for the life of that note;
- detection is **restricted to the range the selected tuning can produce**.
  This one matters more than it looks: two strings ringing together are
  genuinely periodic at their common subharmonic — a perfect fourth apart, E2
  and A2 repeat at ~27.5 Hz — and MPM reports that with high confidence
  because it is the honest answer. Ruling out pitches below the lowest string
  makes it choose a note the instrument can actually play;
- when the pitch does land squarely on a *different* string of the tuning, the
  level decides what it means. Level holding up means the player moved strings,
  so follow it. Level falling means the struck note has faded under a ringing
  neighbour — so report the note as finished and wait for the next pluck. The
  reading is frozen, not shown, while that decision is being made.

Crucially the "is this another string?" test is geometric — how far from the
locked string, how close to a different one — and never involves confidence.
A string tuned a whole tone flat stays locked, because tracking a badly-out
string is the entire job.

Measured on a synthesised pluck decaying under a continuously ringing
neighbour, the reading holds a **0.05 cent** spread across the whole decay and
then goes quiet, with no frame ever showing the wrong string.

---

## Architecture

```
src/
  audio/
    fft.ts             allocation-free radix-2 FFT
    pitch.ts           MPM detector + temporal stabiliser
    AudioEngine.ts     capture, envelope/onset tracking, attack + decay gating
    workletSource.ts   worklet processor (batching only, no DSP on the audio thread)
    tone.ts            reference-tone and chime synthesis
  music/
    notes.ts           MIDI/frequency/cents maths, note naming
    tunings.ts         the tuning library
  tuner/
    TunerController.ts the rAF loop, string latching, tuned-state tracking
  components/
    PitchField.tsx     the scrolling pitch field (canvas)
    ...                everything else
  state/store.ts       persisted settings + session
  hooks/
test/pitch.test.ts     accuracy harness
scripts/generate-icons.mjs   PWA icon generator (zlib only, no deps)
```

**Why the tuner core sits outside React.** The marker, cent readout, trail and
scrolling background all update every animation frame. Routing that through
component state would mean ~60 reconciliations a second for values that touch a
handful of DOM nodes. Instead `TunerController` owns one rAF loop and mutates a
single frame object in place; the field draws to a canvas and the readouts
write through refs. React only handles things that actually change the tree —
which string is selected, which have landed in tune, which sheet is open.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | dev server on localhost |
| `npm run host` | dev server over HTTPS on your LAN, for phones |
| `npm test` | pitch-detection accuracy harness |
| `npm run typecheck` | TypeScript, no emit |
| `npm run build` | typecheck + production build to `dist/` |
| `npm run preview` | serve the production build |
| `npm run icons` | regenerate the PWA icon set |

## Browser support

Needs `AudioWorklet` and `getUserMedia`: Chrome 66+, Edge 79+, Firefox 76+,
Safari 14.5+ (iOS 14.5+). A `ScriptProcessorNode` fallback covers older
engines. Microphone access requires HTTPS or `localhost` everywhere.
