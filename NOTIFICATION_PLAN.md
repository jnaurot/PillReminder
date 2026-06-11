Design Summary
Two notifications per dose:

N1: rem-{medId}-{YYYY-MM-DD}-{HHmm} fires at dose_time — "Time to take {med.name}", standard notification channel
N2: alarm-{medId}-{YYYY-MM-DD}-{HHmm} fires at dose_time + missed_window_minutes — "Missed dose: {med.name}", alarm channel controlled by alarm_type
Settings after change:

Remove from code/UI: alarm_delay_minutes, alarm_enabled (leave DB rows orphaned)
Keep: missed_window_minutes (global setting + per-medication column override)
Keep + expand: alarm_type → four values: sound,vibration / sound / vibration / none
Pool:

POOL_BUDGET = 63 — single named constant, easy to change
2 notifications per dose slot → ~31 dose slots max in pool
Rebuild triggers: app foreground, dose taken/skipped, medication add/edit/delete
Refill notifications outside the pool, entirely unchanged
Step 1 — Settings cleanup
Changes:

src/db/settings.ts: remove alarm_delay_minutes from AppSettings interface, DEFAULTS, and getSettings() parser; stop reading alarm_enabled
src/db/database.ts: remove alarm_delay_minutes from insertDefaultSettings
app/settings.tsx: remove alarm_delay_minutes input; remove alarm_enabled toggle; replace alarm_type radio with four options (Sound + Vibration / Sound / Vibration / Silent); relabel section from "Alarm" to "Missed Dose Alert"
Integration tests:

getSettings() on a DB that has an alarm_delay_minutes row returns without that field and without crashing
All four alarm_type values round-trip correctly through save/load
alarm_enabled DB row untouched by save
Regression tests:

missed_window_minutes, refill_alert_days, primary_name, all other settings unaffected
Existing alarm_type = "sound,vibration" preserved on upgrade
Step 2 — Remove the missed-window notification
Changes:

src/notifications/scheduler.ts: remove scheduleMissedAlertForDate, cancelMissedAlert, missId; remove missed alert calls from scheduleFixedTimes, scheduleWeekly, scheduleMonthly
src/components/DoseCard.tsx: remove cancelMissedAlert import and all call sites
Integration tests:

After scheduleForMedication, no miss- prefixed IDs in the scheduled notification list
Existing rem- and alarm- notifications still scheduled
Regression tests:

cancelForMedication prefix scan unaffected (miss- prefix was already there, now just absent)
DoseCard take/skip flows do not throw on missing import
Step 3 — Remove native alarm path, move alarm to expo
Changes:

src/notifications/scheduler.ts: replace native scheduleAlarmNative / cancelAlarmNative / dismissActiveAlarmNative calls in scheduleAlarmForDate and cancelAlarmAlert with expo scheduleNotificationAsync / cancelScheduledNotificationAsync; add channel selection for alarm_type = "none" → new channel dose-alarm-silent-v3 (max priority, no sound, no vibration)
src/native/alarmScheduler.ts: remove all exports (stub or delete file)
app/_layout.tsx: remove ALARM_VIBRATION_TASK registration; remove the addNotificationReceivedListener vibration block for type === 'alarm' (expo alarm channel handles vibration natively)
src/notifications/backgroundTask.ts: remove ALARM_VIBRATION_TASK definition
src/db/database.ts: stop writing/reading native_alarms table (leave table in schema)
Integration tests:

scheduleAlarmForDate produces an expo scheduled notification (not a native alarm)
Channel selected matches alarm_type: sound,vibration → dose-alarm-v3, sound → dose-alarm-sound-v3, vibration → dose-alarm-vibrate-v3, none → dose-alarm-silent-v3
cancelAlarmAlert cancels the expo notification by correct ID
Regression tests:

cancelForMedication still cancels alarm- prefixed notifications
No crash when native_alarms table exists but is never written
Step 4 — Implement the pool manager
Changes in src/notifications/scheduler.ts:

Add POOL_BUDGET = 63
Add DoseSlot type: { medId, medName, dosage, pillsPerDose, scheduledAt: Date, missedWindowMin: number, color: string }
Add getUpcomingDoseSlots(from: Date, maxSlots: number): Promise<DoseSlot[]>:
Loads all non-deleted medications and global settings
Expands each schedule type (fixed_times / weekly / monthly) forward ~30 days into individual Date instances; skips PRN
Queries dose_logs for the upcoming window; filters out already taken/skipped slots
Sorts ascending by scheduledAt; returns first maxSlots
Add rebuildNotificationPool(): Promise<void>:
Fetches current alarm_type from settings
Calls N.getAllScheduledNotificationsAsync(), cancels all with rem- or alarm- prefix
Calls getUpcomingDoseSlots(now, POOL_BUDGET / 2)
For each slot: schedules N1 (rem-) with standard channel; schedules N2 (alarm-) with alarm channel matching alarm_type; both payloads include { medId, scheduledAt: isoString, type } in data
Refill notifications untouched
Integration tests:

Pool notification count ≤ POOL_BUDGET after rebuild
Slots are in ascending time order
Already-taken doses absent from pool
PRN medications produce no pool entries
Fixed-times: correct date+time combinations
Weekly: correct weekday expansion across multiple weeks
Monthly: correct day-of-month across month boundaries
Budget overflow: slots beyond POOL_BUDGET dropped (furthest future dropped first)
Changing POOL_BUDGET constant changes pool size proportionally
Refill notification IDs not cancelled during rebuild
Regression tests:

N2 alarm channel matches current alarm_type setting
Both N1 and N2 data payloads contain scheduledAt in ISO format
No miss- notifications created
Step 5 — Wire pool manager into all scheduling paths
Changes:

src/notifications/scheduler.ts: scheduleForMedication body replaced with rebuildNotificationPool() call; rescheduleAll simplified to rebuildNotificationPool() + refill rebuild loop; remove scheduleFixedTimes, scheduleWeekly, scheduleMonthly, getNextMonthlyDates
app/entities/[id]/medications/new.tsx and edit.tsx: callers unchanged (same scheduleForMedication signature, now a thin wrapper)
Integration tests:

Add medication → new medication's doses appear in pool
Edit medication schedule → old time slots gone, new ones present
Delete medication (soft delete) → deleted medication absent from pool on next rebuild
rescheduleAll produces identical pool to a fresh rebuildNotificationPool call
Regression tests:

Refill alert scheduling in rescheduleAll loop unaffected
Multiple medications coexist in pool without duplicates
Step 6 — Update dose cancellation in DoseCard
Changes:

src/notifications/scheduler.ts: add cancelDoseNotifications(medId: string, scheduledAtStr: string): Promise<void> — cancels rem-{medId}-{dateStr}-{HHmm} and alarm-{medId}-{dateStr}-{HHmm}; remove dismissScheduledReminderForDose, cancelAlarmAlert
src/components/DoseCard.tsx: replace the three-call sequence (dismissScheduledReminderForDose + cancelMissedAlert + cancelAlarmAlert) with single cancelDoseNotifications call at all take/skip sites
Integration tests:

Take dose → both rem- and alarm- for that exact scheduledAt cancelled
Take dose → tomorrow's notifications for same medication untouched
Skip dose → same two-notification cancellation
Undo dose (deleteLog) → notifications not re-scheduled (pool picks them up on next foreground rebuild)
Regression tests:

Catch-up dose: current dose and catch-up dose both get cancelDoseNotifications called
Must-skip flow: skipped dose notifications cancelled, current dose notifications cancelled
PRN dose: cancelDoseNotifications not called (no scheduledAt)
Caregiver dose attribution (caregiver_id) unaffected by cancellation change
Step 7 — Remove shouldDisplayDoseNotification
Changes:

src/notifications/scheduler.ts: remove shouldDisplayDoseNotification, doseAlreadyCompleted, getNotificationDoseContext, inferReminderScheduledAt
app/_layout.tsx: simplify handleNotification to return { shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false } unconditionally; remove the addNotificationReceivedListener missed-dose dismiss block (no miss- type exists anymore); keep the alarm vibration listener removal from Step 3
Integration tests:

handleNotification returns shouldShowBanner: true for all notification types
No import errors after removals
Regression tests:

Notification tap response listener (addNotificationResponseReceivedListener) unaffected
Cold-start notification routing (getLastNotificationResponseAsync) unaffected
routeForDoseNotification still resolves correct route using data.scheduledAt directly (no inference needed since all notifications now include it in payload)
Step 8 — Foreground rebuild trigger
Changes:

app/_layout.tsx: in the AppState 'active' handler, after the inactivity timeout check, call rebuildNotificationPool()
Integration tests:

Pool count is correct immediately after simulated foreground event
Foreground rebuild excludes doses taken since last rebuild
Inactivity timeout and pool rebuild coexist in same AppState handler without conflict
Regression tests:

Inactivity lock still redirects to / when timeout exceeded
No double-rebuild when app opens cold (cold-start init() already calls rescheduleAll)
Cross-cutting regression tests (run after all steps)
PRN logging, notes, and undo unchanged
Weekly and monthly schedule dose cards show correct status on Today screen
Refill alert fires at correct date; unaffected by pool rebuilds
Backup export/import: restored DB triggers rescheduleAll which rebuilds pool correctly
Deep-link from notification tap scrolls and highlights correct dose card on Today screen
Caregiver shift dose attribution, DOSE_UPDATE messaging unaffected
Compliance report and history screen data unchanged
Sort stability on Today screen unchanged (pool rebuild does not reorder displayed cards)
Settings screen: missed_window_minutes global and per-medication override still respected in both status calculation and N2 timing