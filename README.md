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

## How data flows

- **Events** are time blocks with a color, repeat rule, and optional per-date overrides/exclusions.
- **Overrides** (`edit this day`) change one occurrence's title, time, or color without touching the rest of a series.
- **Exclusions** (`delete this day`) skip a single occurrence by date.
- **Exports** write the full schedule — including overrides and exclusions — to a JSON backup you can re-import anytime.