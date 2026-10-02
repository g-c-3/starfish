// notifications.js — schedules local notifications with custom tone for reminders.
// Uses @capacitor/local-notifications. No AlarmManager/full-screen intent — see android-notes/ for why.

import { LocalNotifications } from '@capacitor/local-notifications';

const CHANNEL_ID = 'dumpzone_reminders';

async function ensureChannel() {
  await LocalNotifications.createChannel({
    id: CHANNEL_ID,
    name: 'Reminders',
    description: 'Dumpzone reminder alerts',
    sound: 'notify_tone.wav', // must exist at android/app/src/main/res/raw/notify_tone.wav
    importance: 5, // max — heads-up notification + sound
    visibility: 1  // show full content on lock screen
  });
}

async function requestPermissions() {
  const perm = await LocalNotifications.requestPermissions();
  return perm.display === 'granted';
}

async function scheduleReminder(entry) {
  // entry: { id, label, fire_at, repeat_rule }
  await ensureChannel();

  const schedule = { at: new Date(entry.fire_at) };
  if (entry.repeat_rule === 'daily') schedule.every = 'day';
  if (entry.repeat_rule === 'weekly') schedule.every = 'week';
  if (entry.repeat_rule === 'monthly') schedule.every = 'month';

  await LocalNotifications.schedule({
    notifications: [{
      id: hashIdToInt(entry.id),
      title: 'Dumpzone Reminder',
      body: entry.label,
      channelId: CHANNEL_ID,
      schedule,
      actionTypeId: 'REMINDER_ACTIONS',
      extra: { entryId: entry.id }
    }]
  });
}

async function cancelReminder(entryId) {
  // The snooze notification has its own id, so cancelling a reminder cancels both.
  await LocalNotifications.cancel({ notifications: [{ id: hashIdToInt(entryId) }, { id: hashIdToInt(`${entryId}:snooze`) }] });
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
      schedule: { at: new Date(Date.now() + minutes * 60 * 1000) },
      actionTypeId: 'REMINDER_ACTIONS',
      extra: { entryId: entry.id }
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

export { scheduleReminder, cancelReminder, snoozeReminder, listenForReminderActions, requestPermissions, registerActionTypes, ensureChannel };
