# Tempo

Tempo is a dependency-free time-block planner. Open `mockups/tempo-scheduler/index.html` for local use, or run `python3 -m http.server 8080` from the project root and visit `http://localhost:8080` (the root page redirects to Tempo) for installable PWA/offline behavior. You can also run the server inside this folder and visit `http://localhost:8080`.

Schedules persist in the browser. Use **Export schedule** before moving devices and **Import schedule** to restore an exported JSON backup.

## Features

- Dark plum / lime / lilac / peach visual design
- Mobile-first responsive layout
- Timed calendar blocks from 7 AM – 10 PM
- Current day timeline and 5-day date selector
- Previous/next day navigation with "Today" button
- Add task composer with title, start/end time, color/category
- Repeat options: once, daily, weekdays, weekly
- Per-date recurring event exceptions (edit or delete a single day without breaking the series)
- Overlap column layout for overlapping events
- Local persistence (localStorage) with optional cloud sync
- Import/export JSON schedule backups
- Demo schedule loader
- Clear schedule action
- Offline-mode status messaging
- PWA manifest and service worker
- Optional Firebase Auth + Firestore cloud sync

## How to run

From the project root:

```
cd "/Users/hrishaan/Documents/Schedule App"
python3 -m http.server 8080
```

Open: http://localhost:8080

The root `index.html` redirects to `mockups/tempo-scheduler/`.

Alternatively:

```
cd "/Users/hrishaan/Documents/Schedule App/mockups/tempo-scheduler"
python3 -m http.server 8080
```

## Firebase setup (optional)

Tempo runs in offline mode by default. To enable cross-device sync via Google sign-in and Firestore:

### 1. Create a Firebase project

1. Go to [Firebase Console](https://console.firebase.google.com/).
2. Click **Add project** and follow the prompts.
3. Give the project a name (e.g. `tempo-scheduler`).

### 2. Enable Google Authentication

1. In the Firebase console, go to **Build > Authentication > Sign-in method**.
2. Click **Google**, enable it, and set a support email.
3. Save.

### 3. Create a Firestore database

1. In the Firebase console, go to **Build > Firestore Database**.
2. Click **Create database**.
3. Start in **production mode** (the security rules are included in `firestore.rules`).
4. Choose a location close to your users.

### 4. Deploy Firestore security rules

Upload the included `firestore.rules` file:

```
firebase deploy --only firestore:rules
```

Or paste the contents of `firestore.rules` into the Firestore console under **Rules**.

The rules ensure each user can only read and write their own schedule document at `users/{uid}/schedule/main`.

### 5. Add Firebase config to Tempo

1. Copy `firebase-config.example.js` to `firebase-config.js`:

   ```
   cp firebase-config.example.js firebase-config.js
   ```

2. Open `firebase-config.js` and replace each value with your Firebase project settings. You can find these in the Firebase console under **Project settings > General > Your apps > Web app**.

   ```js
   window.TEMPO_FIREBASE_CONFIG = {
     apiKey: 'AIzaSy...',
     authDomain: 'your-project.firebaseapp.com',
     projectId: 'your-project',
     storageBucket: 'your-project.appspot.com',
     messagingSenderId: '123456789',
     appId: '1:123456789:web:abc123'
   };
   ```

3. **Do not commit `firebase-config.js`** — it is listed in `.gitignore`.

### 6. Enable the Google sign-in domain

In the Firebase console under **Authentication > Settings > Authorized domains**, make sure `localhost` (and any deployment domain) is listed.

### 7. Test

1. Start the local server and open Tempo.
2. Click the **Offline mode** card or the **•••** settings button.
3. Click **Continue with Google**.
4. Sign in with your Google account.
5. Your schedule now syncs to Firestore automatically.

### How sync works

- On sign-in, Tempo checks for a cloud backup. If both local and cloud data exist, you are prompted to choose which to use.
- Local changes are saved to Firestore in real time.
- Firestore listener updates the UI when the schedule changes (e.g. on another device).
- `localStorage` is kept as an offline cache — the app works fully without an internet connection.

## Recurring event exceptions

Recurring events support per-date overrides and exclusions:

- **Edit this day**: modifies a single occurrence without affecting the rest of the series. An override is stored for that date.
- **Delete this day**: removes a single occurrence by adding the date to an exclusion list. The rest of the series continues.
- **Delete entire series**: removes the source event and all future occurrences.

Override and exclusion data is preserved in localStorage and included in JSON exports.
