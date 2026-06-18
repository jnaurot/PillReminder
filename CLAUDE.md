# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install        # Install dependencies
npm start          # Start Expo dev server
npm run ios        # Run on iOS simulator
npm run android    # Run on Android emulator
npm run web        # Run web version
```

No separate build step — Expo handles TypeScript directly. No test suite or linter is currently configured.

## Architecture Overview

PillReminder is a React Native + Expo Router (file-based routing) app for managing medications and coordinating with caregivers. It uses a local SQLite database (expo-sqlite) with no backend server.

### Navigation & Auth

- Entry: `index.ts` → `App.tsx` → `app/_layout.tsx`
- Biometric auth (Face ID/fingerprint) at splash (`app/index.tsx`) before reaching any screen
- Deep links via `pillreminder://` scheme — handled both cold-start and foreground; notification taps deep-link into schedule screens using `medId` from notification payload

### Database Layer (`src/db/`)

Encrypted SQLite instance via `@op-engineering/op-sqlite` with SQLCipher (singleton in `database.ts`, SCHEMA_VERSION = 13). The encryption key is stored in Android Keystore via `expo-secure-store` (`src/db/cryptoKey.ts`). Migrations run on `initDb()`. Versions < 6 drop and recreate tables; later versions use `ALTER TABLE` with try-catch (safe if column already exists). On first run (version = 0) the legacy unencrypted `pillreminder.db` (expo-sqlite, stored at `files/SQLite/`) is copied into the new encrypted `pillreminder_enc.db` (stored in `databases/`). The op-sqlite API uses `executeSync()` for synchronous DDL/migration and `execute()` (async) for the `CompatDB` wrapper used by all other db modules.

Key modules:
- `entities.ts` — people taking medications
- `medications.ts` — medication records with schedule, dosage, RxCUI
- `doseLogs.ts` — taken/skipped doses; generates scheduled doses for a given date
- `prescriptions.ts` — refill date and quantity tracking
- `caregivers.ts` — caregiver contacts and shift records
- `settings.ts` — global settings (early window, missed window, refill alert days)
- `backup.ts` — CSV export and JSON backup/restore

### Dose Status & Scheduling

`doseLogs.ts` generates scheduled doses for a date by iterating medications and their schedule types (FixedTimes, PRN, Weekly, Monthly). Status values: `'locked' | 'upcoming' | 'due' | 'taken' | 'skipped' | 'missed'`. Status calculation uses the early window (before scheduled time) and missed window (too late to take) from settings.

PRN (as-needed) medications haven't a scheduled time; doses are created on-demand when the user taps "Take PRN".

### Notifications (`src/notifications/`)

Notification IDs follow a stable format to avoid duplicates on reschedule:
- One-shot reminders: `rem-{medId}-{dateStr}-{HHmm}`
- One-shot missed-dose alarms: `alarm-{medId}-{dateStr}-{HHmm}`
- Refill reminders: `refill-{medId}`

### Caregiver Shift System (`src/messaging/`, `src/db/caregivers.ts`)

Shift lifecycle: `pending → confirmed → active → completed`. Flow:
1. Primary user creates a shift, generating a 6-char alphanumeric confirmation code
2. Caregiver receives invite (SMS/deep-link/in-app) containing entity & medication snapshots
3. Caregiver enters code to accept; shift becomes `confirmed`
4. At shift start time, resolves to `active`; dose updates sync via `DOSE_UPDATE` messages
5. Shift auto-completes at end time

Entities delegated to a caregiver are marked `shift_source: 'shared'` with a `shared_shift_id`.

Message types in `src/messaging/types.ts`: `SHIFT_INVITE`, `SHIFT_ACCEPT`, `SHIFT_DECLINE`, `DOSE_UPDATE`, `REFILL_UPDATE`, `SHIFT_HANDBACK`, `SHIFT_COMPLETE`.

### Drug Info Service (`src/services/rxnorm.ts`)

Fetches RxCUI codes and drug info (side effects, pill appearance images) from `https://rxnav.nlm.nih.gov/REST` and the RxImage API. Enrichment runs async on startup; unenriched medications have `rxcui: null`. Network failures are silently tolerated — they don't block app startup.

### Key Types (`src/types/index.ts`)

- Schedule types: `FixedTimes`, `PRN`, `Weekly`, `Monthly`
- Medication interactions: `With` (taken together) and `HoursAfter` relationships
- `Entity`: person with ID, name, DOB, notes
- `Medication`: full record including schedule, interactions, food requirements, missed dose policy
