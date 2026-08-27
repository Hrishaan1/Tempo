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

## How data flows

- **Events** are time blocks with a color, repeat rule, and optional per-date overrides/exclusions.
- **Overrides** (`edit this day`) change one occurrence's title, time, or color without touching the rest of a series.
- **Exclusions** (`delete this day`) skip a single occurrence by date.
- **Exports** write the full schedule — including overrides and exclusions — to a JSON backup you can re-import anytime.