// notifications.js — schedules local notifications for reminders: a banner with the system's default sound.
// Uses @capacitor/local-notifications. No alarm UI, no full-screen intent — see android-notes/ for why.

import { LocalNotifications } from '@capacitor/local-notifications';
import { nextOccurrences } from './reminders.js';

// An Android channel's importance and sound are fixed once created, so a changed style needs a new id (Decision 96).
const CHANNEL_ID = 'dumpzone_reminders_v2';
const OLD_CHANNEL_ID = 'dumpzone_reminders';

async function ensureChannel() {
  await LocalNotifications.createChannel({
    id: CHANNEL_ID,
    name: 'Reminders',
    description: 'Dumpzone reminder alerts',
    importance: 4, // high — heads-up banner, default notification sound, no alarm behaviour
    visibility: 1  // show full content on lock screen
  });
}

// Removes the first-generation channel. Notifications already scheduled on it are dropped by Android once it is
// gone, so the caller reschedules every upcoming reminder after this.
async function retireOldChannel() {
  await LocalNotifications.deleteChannel({ id: OLD_CHANNEL_ID });
}

async function requestPermissions() {
  const perm = await LocalNotifications.requestPermissions();
  return perm.display === 'granted';
}

// Repeating reminders (Decision 106): the plugin fires an `at` notification once and ignores `every` beside it, so a
// repeating reminder is scheduled as its next occurrences, each an ordinary exact one-off. The app tops the window up
// on launch and resume (refillRepeatingReminders). Occurrence k > 0 has id hash(`<entryId>:r<k>`); k = 0 keeps the plain id.
const REPEAT_WINDOW = { daily: 30, weekly: 26, monthly: 12 };
const MAX_OCCURRENCES = 30;
const ALARM_BUDGET = 400; // Android allows 500 alarms per app; stay clear of it across all repeating reminders
const occurrenceId = (entryId, k) => hashIdToInt(k === 0 ? entryId : `${entryId}:r${k}`);

async function scheduleReminder(entry, { windowSize = null } = {}) {
  // entry: { id, label, fire_at, repeat_rule }
  await ensureChannel();
  const base = { title: 'Dumpzone Reminder', body: entry.label, channelId: CHANNEL_ID, actionTypeId: 'REMINDER_ACTIONS', extra: { entryId: entry.id, repeating: !!REPEAT_WINDOW[entry.repeat_rule] } };
  // allowWhileIdle: without it the plugin sets a non-waking RTC alarm, which Doze holds until the phone is next awake (Decision 97).
  const times = REPEAT_WINDOW[entry.repeat_rule]
    ? nextOccurrences(entry.fire_at, entry.repeat_rule, Date.now() + 1000, Math.min(windowSize || REPEAT_WINDOW[entry.repeat_rule], MAX_OCCURRENCES))
    : [entry.fire_at];
  // Occurrences past the new window (or left over from when this was a repeating reminder) are dropped; the ones being
  // scheduled replace their own ids, and a pending snooze is left alone.
  const stale = [];
  for (let k = times.length; k < MAX_OCCURRENCES; k++) stale.push({ id: occurrenceId(entry.id, k) });
  await LocalNotifications.cancel({ notifications: stale });
  if (!times.length) return;
  await LocalNotifications.schedule({
    notifications: times.map((at, k) => ({ ...base, id: occurrenceId(entry.id, k), schedule: { at: new Date(at), allowWhileIdle: true } }))
  });
}

// Tops up every live repeating reminder's window. Called on launch and on resume (throttled by the caller).
async function refillRepeatingReminders(rows) {
  const repeating = rows.filter((r) => REPEAT_WINDOW[r.repeat_rule]);
  const windowSize = Math.max(1, Math.min(30, Math.floor(ALARM_BUDGET / Math.max(1, repeating.length))));
  for (const r of repeating) await scheduleReminder(r, { windowSize });
}

// Done on a repeating reminder (Decision 108): only a pending snooze goes; the occurrences stay scheduled.
async function cancelSnooze(entryId) {
  await LocalNotifications.cancel({ notifications: [{ id: hashIdToInt(`${entryId}:snooze`) }] });
}

async function cancelReminder(entryId) {
  // The snooze notification has its own id, so cancelling a reminder cancels both.
  const ids = [{ id: hashIdToInt(`${entryId}:snooze`) }];
  for (let k = 0; k < MAX_OCCURRENCES; k++) ids.push({ id: occurrenceId(entryId, k) }); // every repeating occurrence too
  await LocalNotifications.cancel({ notifications: ids });
}

// One-off notification N minutes from now. Separate id so snoozing a repeating reminder
// does not replace its recurring schedule.
async function snoozeReminder(entry, minutes = 10) {
  await ensureChannel();
  await LocalNotifications.schedule({
    notifications: [{
      id: hashIdToInt(`${entry.id}:snooze`),
      title: 'Dumpzone Reminder',
      body: entry.label,
      channelId: CHANNEL_ID,
      schedule: { at: new Date(Date.now() + minutes * 60 * 1000), allowWhileIdle: true },
      actionTypeId: 'REMINDER_ACTIONS',
      extra: { entryId: entry.id, repeating: !!entry.repeat_rule }
    }]
  });
}

// Calls onAction(actionId, entryId) for the Snooze / Done buttons on a reminder notification. Plain taps
// on the notification body are ignored on purpose: opening an entry from a notification could show
// content while the app is still locked.
function listenForReminderActions(onAction) {
  LocalNotifications.addListener('localNotificationActionPerformed', (event) => {
    const entryId = event?.notification?.extra?.entryId;
    if (entryId && (event.actionId === 'snooze' || event.actionId === 'done')) onAction(event.actionId, entryId);
  });
}

async function registerActionTypes() {
  await LocalNotifications.registerActionTypes({
    types: [{
      id: 'REMINDER_ACTIONS',
      actions: [
        { id: 'snooze', title: 'Snooze 10 min' },
        { id: 'done', title: 'Done', destructive: false }
      ]
    }]
  });
}

// Notification IDs must be 32-bit ints; derive a stable one from the entry's uuid.
function hashIdToInt(uuid) {
  let hash = 0;
  for (let i = 0; i < uuid.length; i++) {
    hash = (hash * 31 + uuid.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

export { retireOldChannel, scheduleReminder, refillRepeatingReminders, cancelReminder, cancelSnooze, snoozeReminder, listenForReminderActions, requestPermissions, registerActionTypes, ensureChannel };
