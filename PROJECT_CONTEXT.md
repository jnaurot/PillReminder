# PillReminder — Project Context Snapshot

**Date:** 2026-05-12
**Current Branch:** master
**App Version:** 1.1.0
**Expo SDK:** 54.0.33
**React Native:** 0.81.5 (New Architecture / Fabric enabled)
**React:** 19.1.0
**Build Profile:** Production APK via Android Studio (`android/`)

---

## What This App Is

React Native + Expo Router (file-based routing) medication reminder for family caregivers. Offline-first SQLite local database. No backend server. Biometric auth at launch. Deep links via `pillreminder://`. SMS-based caregiver shift handoff.

---

## Recent Changes (Last Session)

### Schedule Screen (Complete)
- Scrollable date window with today at index 0, no fixed future dates
- `minDate` derived from earliest `dose_logs.scheduled_at`
- `loadInitial()` respects `minDate` to prevent loading stale historical data
- Removed fixed date bar above scrolling dose list
- "Today's Schedule" renamed to "Schedule" on Persons page

### Test Suite (Complete)
- 113 passing tests across 6 suites
- `doseStatus.test.ts` — boundary tests for `getDoseStatus`
- `scheduleDates.test.ts` — date arithmetic and section building
- `parseSchedule.test.ts` / `parseInteractions.test.ts` — shape validation
- `database.test.ts` / `caregivers.test.ts` — CRUD operations

### Dependency Fixes
- `react@19.1.0` + `react-dom@19.1.0` (must match RN 0.81.5 renderer)
- `jest@29.7.0` + `@types/jest@29.5.14` (Expo SDK 54 matrix)
- `expo-constants@18.0.13` (deduplicated, matches other Expo packages)
- `expo doctor`: 17/17 checks pass

### Removed Files
- `index.ts` (legacy `registerRootComponent` entry point — conflicted with expo-router)
- `App.tsx` (unused default component)

### Native Android Alarm System (In Progress / Debugging)
Custom Kotlin native modules for missed-dose alarms with full-screen activity + vibration:

| File | Purpose |
|------|---------|
| `AlarmSchedulerModule.kt` | Schedules/cancels `AlarmManager` alarms from JS |
| `AlarmReceiver.kt` | Broadcast receiver: posts notification + starts foreground service |
| `AlarmActivity.kt` | Full-screen activity with vibration + Dismiss button |
| `AlarmVibrationService.kt` | Foreground service: persistent vibration + overlay + auto-stop |

**Current State:** Vibration fires but full-screen activity / notification are suppressed on ColorOS/Oppo devices. Work in progress.

**Known Issue:** On ColorOS, `setFullScreenIntent()` and `startActivity()` from background are aggressively blocked by the OS. Foreground service notification also hidden. Requires user to manually whitelist in battery settings.

**Auto-safety:** Service auto-stops after 60 seconds to prevent stuck vibration.

### Production Build
- EAS project configured: `projectId: 73247960-dbd6-4db0-b6ed-ecfe1b4cb1b2`
- Owner: `naurot`
- `eas.json`: production profile with `buildType: apk`
- APK successfully built and installed on test device
- iOS `bundleIdentifier` added: `com.bawlmorean.pillreminder`
- `ITSAppUsesNonExemptEncryption: false` set in `infoPlist`

---

## Architecture Overview

### Entry Flow
1. `expo-router/entry` → `app/_layout.tsx` (Stack navigator)
2. `app/index.tsx` — Splash screen with biometric auth (`expo-local-authentication`)
3. After auth → `app/today.tsx` (schedule list)

### Database (`src/db/`)
- Singleton SQLite instance, SCHEMA_VERSION = 10
- Tables: `settings`, `entities`, `medications`, `prescriptions`, `dose_logs`, `caregivers`, `caregiver_shifts`, `native_alarms`
- Migrations: try-catch `ALTER TABLE ADD COLUMN` for versions 6–10

### Dose Status Engine (`src/db/doseLogs.ts`)
- `getDoseStatus(scheduledAt, log, earlyWindow, missedWindow)`
- States: `locked | upcoming | due | taken | skipped | missed`
- Boundaries: earlyWindow=30min before, missedWindow=60min after

### Notifications (`src/notifications/`)
- Repeating reminders: `rem-{medId}-{slot}`
- Missed alerts: `miss-{medId}-{date}-{HHmm}`
- Refill reminders: `refill-{medId}`
- Native alarms: `alarm-{medId}-{date}-{HHmm}` (Android-only, custom Kotlin)

### Caregiver Shift System (`src/messaging/`, `src/db/caregivers.ts`)
- Shift lifecycle: `pending → confirmed → active → completed`
- Confirmation code pattern + SMS deep-link (`pillreminder://caregivers/incoming?t=...&d=...`)
- Entity/medication snapshot embedded in LZString-compressed payload
- `DOSE_UPDATE` messages sync dose logs bidirectionally during active shift

### Drug Info (`src/services/rxnorm.ts`)
- Fetches RxCUI from `rxnav.nlm.nih.gov`
- Drug info from `medlineplus.gov`
- Pill images from `rximage.nlm.nih.gov`
- Runs async on startup, silently tolerates network failures

---

## Critical Configuration

### `app.json`
```json
{
  "expo": {
    "name": "PillReminder",
    "slug": "pillreminder",
    "scheme": "pillreminder",
    "version": "1.1.0",
    "newArchEnabled": true,
    "ios": { "bundleIdentifier": "com.bawlmorean.pillreminder", ... },
    "android": { "package": "com.bawlmorean.pillreminder", ... },
    "extra": { "eas": { "projectId": "73247960-dbd6-4db0-b6ed-ecfe1b4cb1b2" } },
    "owner": "naurot"
  }
}
```

### `eas.json`
```json
{
  "build": {
    "production": {
      "autoIncrement": true,
      "android": { "buildType": "apk" }
    }
  }
}
```

---

## Pending Tasks / Open Issues

### High Priority
1. **Android Alarm UI on ColorOS** — Full-screen activity + notification suppressed when app backgrounded/screen off. Need either:
   - User education on battery whitelist settings, OR
   - Fallback to `NotificationCompat` with high-priority heads-up that reliably shows Dismiss
   - Consider auto-stop timeout reduction from 60s to 30s

2. **Caregiver Protocol Security** — Deep-link payload is LZString-compressed but not encrypted. Next step: AES-256-GCM with confirmation code as PSK.

### Medium Priority
3. **iOS Build** — Requires Apple Developer account ($99/year). No iOS-specific code tested yet. Native alarm system is Android-only.

4. **Central Server Discussion** — Evaluated SMS vs Bluetooth vs Wi-Fi tunnel vs central server. Consensus: encrypted SMS is immediate fix; central server is long-term if app scales to multiple caregivers.

5. **React Native New Architecture** — `newArchEnabled: true` with custom native modules. The `@ReactModule` annotation was added for TurboModule interop. Monitor for runtime issues.

### Low Priority
6. **Notification Channel Cleanup** — Old builds may have created channels at `IMPORTANCE_LOW`. Current code deletes and recreates, but a user-uninstall-reinstall is the cleanest reset.

---

## Build Commands

```bash
# Local Android debug (fastest, zero EAS credits)
cd android && ./gradlew assembleDebug && adb install -r app/build/outputs/apk/debug/app-debug.apk

# Local Android release (requires release keystore)
cd android && ./gradlew assembleRelease

# EAS cloud build (uses ~2 credits per build)
eas build --platform android --profile production

# Tests
npm test

# Expo doctor check
npx expo-doctor
```

---

## Device Testing Notes

**Primary Test Device:** ColorOS/Oppo (Android with `OplusHansManager`, aggressive battery optimization)

**Required Manual Permissions on ColorOS:**
1. Settings → Apps → PillReminder → Notifications → Priority / Urgent
2. Settings → Privacy → Special app access → Display over other apps → Allow
3. Settings → Privacy → Special app access → Alarms & Reminders → Allow
4. Settings → Battery → App Battery Management → PillReminder → Disable optimization

---

## File Inventory (Key Files)

| File | Purpose |
|------|---------|
| `app.json` | Expo app config, EAS project ID, deep-link scheme |
| `eas.json` | Build profiles (dev/preview/production) |
| `package.json` | Dependencies locked to Expo SDK 54 matrix |
| `app/_layout.tsx` | Root layout: Stack navigator, notification init, deep-link handlers |
| `app/index.tsx` | Splash + biometric auth |
| `app/today.tsx` | Daily schedule with scrollable doses |
| `src/db/database.ts` | SQLite singleton, SCHEMA_VERSION=10 |
| `src/db/doseLogs.ts` | Dose status engine, scheduled dose generation |
| `src/notifications/scheduler.ts` | Notification scheduling, native alarm bridge |
| `src/notifications/permissions.ts` | Notification channel setup, permission requests |
| `src/native/alarmScheduler.ts` | JS bridge to Kotlin `AlarmSchedulerModule` |
| `android/app/src/main/java/.../AlarmSchedulerModule.kt` | Native alarm scheduler |
| `android/app/src/main/java/.../AlarmReceiver.kt` | Alarm broadcast receiver |
| `android/app/src/main/java/.../AlarmActivity.kt` | Full-screen alarm UI |
| `android/app/src/main/java/.../AlarmVibrationService.kt` | Foreground vibration service |
| `android/app/src/main/AndroidManifest.xml` | Permissions + activity/service declarations |
