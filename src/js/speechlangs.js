// speechlangs.js — the languages Google's speech service can be asked for (Decision 412), as BCP-47 tags, and their names.
// A language with one entry shows its plain name ("Tamil"); one with several shows the region ("English (US)").
export const SPEECH_LANGS = [
  'af-ZA', 'sq-AL', 'am-ET', 'ar-SA', 'ar-EG', 'ar-AE', 'ar-IQ', 'ar-JO', 'ar-KW', 'ar-LB', 'ar-MA', 'ar-QA', 'ar-DZ', 'ar-TN',
  'hy-AM', 'az-AZ', 'eu-ES', 'bn-IN', 'bn-BD', 'bs-BA', 'bg-BG', 'my-MM', 'ca-ES', 'zh-CN', 'zh-TW', 'yue-Hant-HK', 'hr-HR', 'cs-CZ',
  'da-DK', 'nl-NL', 'nl-BE', 'en-US', 'en-GB', 'en-IN', 'en-AU', 'en-CA', 'en-IE', 'en-NZ', 'en-ZA', 'en-SG', 'en-PH', 'en-NG', 'en-KE',
  'et-EE', 'fil-PH', 'fi-FI', 'fr-FR', 'fr-CA', 'fr-BE', 'fr-CH', 'gl-ES', 'ka-GE', 'de-DE', 'de-AT', 'de-CH', 'el-GR', 'gu-IN',
  'he-IL', 'hi-IN', 'hu-HU', 'is-IS', 'id-ID', 'ga-IE', 'it-IT', 'it-CH', 'ja-JP', 'jv-ID', 'kn-IN', 'kk-KZ', 'km-KH', 'ko-KR',
  'lo-LA', 'lv-LV', 'lt-LT', 'mk-MK', 'ms-MY', 'ml-IN', 'mr-IN', 'mn-MN', 'ne-NP', 'nb-NO', 'fa-IR', 'pl-PL', 'pt-BR', 'pt-PT',
  'pa-IN', 'ro-RO', 'ru-RU', 'sr-RS', 'si-LK', 'sk-SK', 'sl-SI', 'es-ES', 'es-MX', 'es-US', 'es-AR', 'es-CO', 'es-CL', 'es-PE',
  'es-VE', 'su-ID', 'sw-KE', 'sw-TZ', 'sv-SE', 'ta-IN', 'te-IN', 'th-TH', 'tr-TR', 'uk-UA', 'ur-PK', 'uz-UZ', 'vi-VN', 'zu-ZA'
];

const baseOf = (tag) => tag.split('-')[0];
const COUNT = new Map();
for (const t of SPEECH_LANGS) COUNT.set(baseOf(t), (COUNT.get(baseOf(t)) || 0) + 1);

const SHORT = { 'United States': 'US', 'United Kingdom': 'UK', 'United Arab Emirates': 'UAE', 'Hong Kong SAR China': 'Hong Kong', 'Hong Kong': 'Hong Kong' };
const names = (locale, type) => { try { return new Intl.DisplayNames([locale], { type }); } catch { return null; } };
let lang = null, region = null;

export function langName(tag) {
  lang = lang || names('en', 'language'); region = region || names('en', 'region');
  const base = baseOf(tag);
  let name = tag;
  try { name = (lang && lang.of(base === 'fil' ? 'fil' : base)) || tag; } catch { /* the tag stands in */ }
  if (tag === 'yue-Hant-HK') return 'Cantonese (Hong Kong)';
  if (tag === 'zh-CN' || tag === 'zh-TW') name = 'Chinese';
  if ((COUNT.get(base) || 0) > 1 || base === 'zh') {
    const r = tag.split('-').pop();
    let rn = r;
    try { rn = (region && region.of(r)) || r; } catch { /* the code stands in */ }
    if (base === 'zh') rn = r === 'CN' ? 'Mandarin, Simplified' : 'Mandarin, Traditional';
    else rn = SHORT[rn] || rn;
    return `${name} (${rn})`;
  }
  return name;
}

// The name in the language itself, shown small beside non-English names ("தமிழ்"); '' when it adds nothing.
export function nativeName(tag) {
  const base = baseOf(tag);
  if (base === 'en') return '';
  const d = names(base, 'language');
  try { const n = d && d.of(base); return n && n.toLowerCase() !== langName(tag).toLowerCase() && !langName(tag).toLowerCase().startsWith(n.toLowerCase()) ? n : ''; } catch { return ''; }
}

// The tag to start from: the last one used, else the first of the phone's own languages the service has, else English (US).
export function defaultLanguage(recent, phoneTags) {
  const known = new Set(SPEECH_LANGS);
  if (recent && recent.length && known.has(recent[0])) return recent[0];
  for (const t of phoneTags || []) {
    if (known.has(t)) return t;
    const same = SPEECH_LANGS.find((x) => baseOf(x) === baseOf(t));
    if (same) return same;
  }
  return 'en-US';
}
