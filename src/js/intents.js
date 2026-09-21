// pure rule-based (regex/keyword) intent detection. no automated inference, no network.
// Runs on any text: typed notes, voice labels, OCR'd text.

// ---- Handler registry (extensible: add new handlers without touching the engine) ----
const handlers = [];
function registerIntentHandler(handler) {
  // handler: { name, test(text) -> bool, extract(text) -> data, buildEntry(data) -> partialEntry }
  handlers.push(handler);
}

function detectIntent(text) {
  for (const h of handlers) {
    if (h.test(text)) {
      return { handler: h.name, data: h.extract(text) };
    }
  }
  return null;
}

// ===== Reminder handler =====
// Matches things like: "remind me at 5pm for shopping", "remind me tomorrow at 9am to call mom"
const REMINDER_TRIGGER = /\bremind me\b/i;
const TIME_PATTERN = /\b(at\s+)?(\d{1,2})(:(\d{2}))?\s*(am|pm)?\b/i;
const DAY_WORDS = /\b(today|tomorrow|tonight)\b/i;

function parseTimeToEpoch(text) {
  const now = new Date();
  const dayMatch = text.match(DAY_WORDS);
  const timeMatch = text.match(TIME_PATTERN);

  let target = new Date(now);
  if (dayMatch && dayMatch[1].toLowerCase() === 'tomorrow') {
    target.setDate(target.getDate() + 1);
  }

  if (timeMatch) {
    let hour = parseInt(timeMatch[2], 10);
    const minute = timeMatch[4] ? parseInt(timeMatch[4], 10) : 0;
    const meridiem = timeMatch[5] ? timeMatch[5].toLowerCase() : null;

    if (meridiem === 'pm' && hour < 12) hour += 12;
    if (meridiem === 'am' && hour === 12) hour = 0;
    // No am/pm given and hour is ambiguous (1-7): assume next occurrence (pm if it's already past that hour am today)
    target.setHours(hour, minute, 0, 0);

    if (!meridiem && hour >= 1 && hour <= 7 && target < now) {
      target.setHours(hour + 12, minute, 0, 0);
    }
  }

  // If resulting time already passed today and no explicit day given, push to tomorrow
  if (target < now && !dayMatch) {
    target.setDate(target.getDate() + 1);
  }

  return target.getTime();
}

function extractReminderLabel(text) {
  // Strip trigger phrase and time phrase, keep the remainder as the reminder's subject
  let cleaned = text.replace(REMINDER_TRIGGER, '');
  cleaned = cleaned.replace(DAY_WORDS, '');
  cleaned = cleaned.replace(TIME_PATTERN, '');
  cleaned = cleaned.replace(/\bfor\b|\bto\b/i, '').trim();
  cleaned = cleaned.replace(/^[\s,.-]+|[\s,.-]+$/g, '');
  return cleaned || 'Reminder';
}

registerIntentHandler({
  name: 'reminder',
  test: (text) => REMINDER_TRIGGER.test(text),
  extract: (text) => ({
    fire_at: parseTimeToEpoch(text),
    label: extractReminderLabel(text)
  }),
  buildEntry: (data) => ({
    type: 'reminder',
    label: data.label,
    fire_at: data.fire_at,
    repeat_rule: null
  })
});

// ===== Expense handler =====
// Matches things like: "spent 500 today", "spent ₹500 on groceries", "i spent 1200"
const EXPENSE_TRIGGER = /\bspent\b/i;
const AMOUNT_PATTERN = /(?:₹|rs\.?|inr)?\s*(\d+(?:[.,]\d+)?)/i;

function extractExpense(text) {
  const amountMatch = text.match(AMOUNT_PATTERN);
  const amount = amountMatch ? parseFloat(amountMatch[1].replace(',', '')) : null;

  // Look for an inline category: "spent 500 on groceries" / "spent 500 for shopping"
  const categoryMatch = text.match(/\b(?:on|for)\s+([a-zA-Z ]+)/i);
  const category = categoryMatch ? categoryMatch[1].trim() : null;

  return { amount, category, replied: !!category };
}

registerIntentHandler({
  name: 'expense',
  test: (text) => EXPENSE_TRIGGER.test(text) && AMOUNT_PATTERN.test(text),
  extract: (text) => extractExpense(text),
  buildEntry: (data) => ({
    type: 'expense',
    label: data.category ? `Expense: ${data.category}` : 'Expense: uncategorized',
    amount: data.amount,
    expense_category: data.category || 'uncategorized',
    replied: data.replied ? 1 : 0
  })
});

// ===== OCR keyword-based label suggestion (not blocking, just a helper for the label prompt) =====
const LABEL_SUGGESTIONS = [
  { keywords: /invoice no|total due|bill to/i, label: 'Invoice' },
  { keywords: /upi|paid to|transaction id|payment successful/i, label: 'Payment Screenshot' },
  { keywords: /prescription|rx|dosage|mg\b/i, label: 'Prescription' },
  { keywords: /passport|aadhaar|driving licence|identity card/i, label: 'ID Proof' },
  { keywords: /receipt|thank you for your purchase/i, label: 'Receipt' }
];

function suggestLabel(ocrText) {
  if (!ocrText) return null;
  for (const s of LABEL_SUGGESTIONS) {
    if (s.keywords.test(ocrText)) return s.label;
  }
  return null;
}

export { registerIntentHandler, detectIntent, suggestLabel, parseTimeToEpoch };
