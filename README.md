# Tempo

Tempo is a calm, mobile-first time-block planner. It helps you *make room* for the things that matter — homework, study, rest, and everything in between — by protecting a slice of your day for each one.

The app is a single static page: no build step, no framework, no dependencies. Schedule data lives in your browser.

## The idea

- **Stock your day before it happens.** Plan time blocks from 7 AM to 10 PM on an animated, swipeable-day timeline.
- **A color for every kind of time.** Each block gets a mood: homework `peach`, study `lilac`, reset `aqua`, activity `lime`.
- **Build it into your routine.** Blocks can repeat daily, every weekday, or weekly — and you can edit or skip a single day without breaking the series.
- **Room to breathe.** A weekly summary tracks how much time is protected (and how much is left to just be you).

## Features

- Animated date carousel: picks slide smoothly so the chosen day lands on the lime marker, with previous/next day navigation and a "Today" button
- Time-block timeline with a live "now" indicator and overlap column layout
- Add/edit composer with title, start/end time, color, and repeat rule
- Recurring event exceptions: edit a single occurrence, delete a single day, or delete the whole series
- Weekly "time protected" summary with a mini bar chart
- Overlap detection so simultaneous blocks stack in side-by-side columns
- Hover animations (desktop) and tap/press feedback (all devices)
- Responsive: a phone-first single column on small screens, plus a side panel of weekly insights on wide screens
- Offline-first: schedules persist in `localStorage` and the app installs as a PWA
- Import/export JSON backups and a one-click demo schedule
- Optional cross-device sync via Google sign-in and Firestore

## Running locally

Serve the folder as a static site. From inside `/Tempo`:

```
python3 -m http.server 8080
```

Open <http://localhost:8080>.

The PWA installs and works offline when served over HTTP(S) — just use the install icon in your browser.

## Cloud sync (optional)

Tempo runs fully offline by default. To enable cross-device sync:

1. Copy `firebase-config.example.js` to `firebase-config.js` and fill in your Firebase web-app settings.
2. Enable **Google** sign-in and create a **Firestore** database in the Firebase console.
3. Load the rules in `firestore.rules` (each user can only touch their own `users/{uid}/schedule/main` document).
4. Add your deployment domain to **Authentication > Settings > Authorized domains**.

Then, from any screen, open settings and **Continue with Google**. If both local and cloud schedules exist, Tempo asks which to keep. Changes save to Firestore in real time while `localStorage` stays as the offline cache.

## Reminders (notifications)

Tempo can nudge you before each time block starts. Reminders are scheduled **on your device**, so they fire even with no internet.

1. Open **Settings → Remindless** and flip on **Remind me before blocks**.
2. Allow notifications when the browser asks. (On iPhone/iPad, install the app to your home screen first — web notifications require an installed PWA.)
3. Pick a lead time: at start, or 5 / 15 / 30 minutes before.

How delivery works:

- **Chromium (Android; desktop Chrome/Edge with the trigger flag)** — Tempo schedules each reminder on-device via the Notification Triggers API. It fires even when Tempo is closed and fully offline.
- **Other browsers (incl. iOS Safari and Firefox)** — reminders appear while Tempo is open; the page checks every 20 seconds.
- Every schedule change re-arms pending reminders, so edited or deleted blocks never fire stale alerts. Show a reminder once per block, per lead time, per day.

### Firebase push — deliver reminders when Tempo is closed

The offline path covers Chromium. To get the OS to deliver the nudge on every device (even with the app closed, on any supported browser), forward due reminders through Firebase Cloud Messaging:

1. Firebase console → **Project settings → Cloud Messaging → Web push certificates**. Copy the *key pair* into `firebase-config.js` as `vapidKey: '...'`.
2. Deploy the sender function (already in `functions/`) so a server can push at the right time. Scheduled triggers need the Blaze (pay-as-you-go) plan:
   ```
   cd functions
   npm install
   firebase use tempo-67a44                       # or your project id
   firebase deploy --only functions:sendReminders
   ```
3. Sign in with Google in Tempo and enable reminders. Tempo stores this device's token under `users/{uid}/fcmTokens` and your prefs under `users/{uid}/notificationSettings/main`.
4. `sendReminders` runs every 5 minutes: it compares your schedule to the current time (using the timezone saved with the schedule) and pushes to every signed-in device. To test the wiring without waiting, deploy `sendTestPush` as well and call it from the app.
5. A one-off test is also possible from Firebase console → **Cloud Messaging → Send test message** to the device you're signed in on.

Files: `notifications.js` (client engine + token management), `firebase-messaging-sw.js` (push + offline-scheduled service worker), `functions/index.js` (server sender). The existing `firestore.rules` already permits each user to read/write these new paths.

## Apple Calendar feed (one-way)

Tempo can publish a private iCalendar feed that Apple Calendar subscribes to, so
time blocks and all-day notes stay in sync **from Tempo → Apple Calendar**
without manual export.

How it works:

- Open **Settings → Apple Calendar → Create subscription link** (Google sign-in
  required, since the feed is generated server-side from your Firestore
  schedule).
- Tempo generates a high-entropy, per-user bearer token. Only its SHA-256 hash
  is stored (in `calendarSubscriptions/{hash}` and a private marker under
  `users/{uid}/integrations/appleCalendar`); the plaintext link is shown once and
  cached only on that device.
- Copy the link into **Calendar → File → New Calendar Subscription…** (macOS) or
  **Settings → Calendar → Accounts → Add Account → Other → Add Subscribed
  Calendar** (iOS/iPadOS).
- **Revoke** deletes the lookup record; the old URL immediately returns 404.
  Generate a fresh link at any time.

The feed is regenerated on every request from the current schedule:

- `functions/calendar.js` — pure feed logic (recurrence expansion, floating
  local times, escaping, VEVENT/UID generation). Shared by both backend paths.
- `api/` — Vercel serverless routes: `createAppleCalendarToken`,
  `revokeAppleCalendarToken`, and `appleCalendarFeed` (plus `_firebaseAdmin.js`
  / `_http.js` helpers). These use the Firebase Admin SDK.
- `calendar.js` — the Settings sheet in the web app, which calls `/api/…`.
- `firebase.js` — exposes `getIdToken()` so the page can authenticate those
  calls with the signed-in user's Firebase ID token.

> The old Firebase Cloud Functions version (in `functions/index.js`) still exists
> but is **not deployed** — it would require the Blaze plan. The Vercel routes
> above give the same behaviour on the free Hobby plan.

Notes:

- Recurring blocks are expanded into individual occurrences with **stable,
  per-date UIDs** (a rolling ~1-month look-back / ~1-year look-ahead window,
  capped at 8000 events). Edits keep the UID and update details; deletions
  simply disappear on the next refresh.
- Times are emitted as **floating** local times because the schedule stores
  local wall-clock minutes with no IANA zone; this preserves the intended local
  time across daylight-saving changes. All-day items use `VALUE=DATE`.
- Apple Calendar chooses its own refresh cadence (the feed requests ~15 min via
  `X-PUBLISHED-TTL`), so changes are not instant.

Deploying the backend on Vercel (free, no billing account):

1. Create a Firebase **service-account key**: Firebase console → Project
   settings → Service accounts → **Generate new private key**. This is free; it
   just lets the API routes read/write Firestore with admin rights.
2. Add the whole JSON (single line is fine) as a Vercel project environment
   variable named `FIREBASE_SERVICE_ACCOUNT` — Settings → Environment Variables —
   for Production (and Preview, if you want to test there). Do **not** commit it
   (`.env` / `.env.* ` are gitignored).
3. Push the repo (Vercel builds the `/api/*.js` routes and installs
   `firebase-admin` + `ical-generator` from the root `package.json`). No
   `vercel.json` is needed. To test locally:
   ```
   npm install
   vercel env pull
   vercel dev
   ```
4. On the same domain as the app, the feed URL is now
   `https://tempo-scheduler.vercel.app/api/appleCalendarFeed?token=…`, and the
   "Create subscription link" button hits `/api/createAppleCalendarToken` with
   the signed-in user's ID token.

Notes:

- No Firestore rules change: the `calendarSubscriptions` index is only ever
  touched by the Admin SDK, and each user can only read/write their own
  `users/{uid}/**` data.
- If the site is ever served from a different origin, set
  `window.TEMPO_CALENDAR_API_BASE` to the app origin before `calendar.js`
  loads.

## How data flows

- **Events** are time blocks with a color, repeat rule, and optional per-date overrides/exclusions.
- **Overrides** (`edit this day`) change one occurrence's title, time, or color without touching the rest of a series.
- **Exclusions** (`delete this day`) skip a single occurrence by date.
- **Exports** write the full schedule — including overrides and exclusions — to a JSON backup you can re-import anytime.