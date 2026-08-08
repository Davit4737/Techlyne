// Chat-widget presentation: quick actions and avatar.
//
// Lives in _lib rather than in either endpoint because two different callers need the SAME
// answer: api/chat.js serves it publicly to the widget, and api/my-business.js accepts edits to
// it from the owner. If the defaults or the validation drifted apart, an owner could save
// something the widget then refuses to render.

// The one-tap prompts every business starts with. `prompt` is what actually gets sent to the
// assistant as if the visitor had typed it, so each one is phrased as a visitor would speak,
// not as a command.
export const DEFAULT_QUICK_ACTIONS = [
  { key: "book",    label: "Book an appointment", prompt: "I'd like to book an appointment." },
  { key: "prices",  label: "Check prices",        prompt: "What do your services cost?" },
  { key: "contact", label: "Contact the clinic",  prompt: "How can I reach you — phone, address and opening hours?" },
];

const MAX_ACTIONS = 6;
const MAX_LABEL = 40;
const MAX_PROMPT = 300;
// Word caps as well as character caps. A label is a button: past about four words it stops
// looking like one and starts wrapping or scrolling the row off-screen. The prompt is what the
// visitor "says", so it has more room, but it is still one sentence and not an essay.
export const MAX_LABEL_WORDS = 4;
export const MAX_PROMPT_WORDS = 25;

// Trims to a word count without cutting mid-word, which is what a plain character slice does.
export function clampWords(str, maxWords) {
  const words = String(str || "").trim().split(/\s+/).filter(Boolean);
  return words.length <= maxWords ? words.join(" ") : words.slice(0, maxWords).join(" ");
}

// A 128px square at JPEG quality ~0.85 lands well under this; the cap exists so a hand-crafted
// request can't park megabytes in a column that is then inlined into every widget load.
export const MAX_AVATAR_BYTES = 60 * 1024;
const AVATAR_PREFIX = /^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+$/;

// Resolves what the widget should actually show, from a business row.
//
// A NULL quick_actions column means "never configured" and yields the defaults — that is what
// makes the feature on-by-default for every existing business without a backfill. An empty
// array is a real choice ("all of them off") and is preserved as such.
export function resolveQuickActions(row) {
  // A missing row (unknown or not-yet-active slug) still yields the defaults: the widget installs
  // and looks correct while an owner is testing it before their subscription goes live. Only an
  // explicit quick_actions_on === false turns them off.
  if (row && row.quick_actions_on === false) return [];
  const stored = row && row.quick_actions;
  if (!Array.isArray(stored)) return DEFAULT_QUICK_ACTIONS.slice();
  return stored
    .filter((a) => a && a.enabled !== false && a.label && a.prompt)
    .slice(0, MAX_ACTIONS)
    // Capped here too, not just on write: rows saved before these limits existed, or edited
    // straight through the API, must still render as buttons rather than paragraphs.
    .map((a) => ({
      key: String(a.key || "").slice(0, 24),
      label: clampWords(a.label, MAX_LABEL_WORDS).slice(0, MAX_LABEL),
      prompt: clampWords(a.prompt, MAX_PROMPT_WORDS).slice(0, MAX_PROMPT),
    }));
}

// Rebuilds the owner's submitted quick actions from scratch rather than trusting the shape that
// arrived. Returns undefined when the input isn't usable, so the caller can leave the column
// alone instead of writing junk over a working config.
export function sanitizeQuickActions(raw) {
  if (!Array.isArray(raw)) return undefined;
  const seen = new Set();
  const out = [];
  for (const a of raw.slice(0, MAX_ACTIONS)) {
    // Word cap first, then the character cap as a hard backstop against very long single words.
    const label = clampWords((a && a.label) || "", MAX_LABEL_WORDS).slice(0, MAX_LABEL);
    const prompt = clampWords((a && a.prompt) || "", MAX_PROMPT_WORDS).slice(0, MAX_PROMPT);
    if (!label || !prompt) continue;
    // Keys identify a button across saves; de-duplicate so one can't shadow another.
    // Trailing/leading separators are stripped, or a label like "Emergency?" yields "emergency-".
    let key = String((a && a.key) || label).toLowerCase()
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24) || "action";
    while (seen.has(key)) key += "x";
    seen.add(key);
    out.push({ key, label, prompt, enabled: (a && a.enabled) !== false });
  }
  return out;
}

// Accepts only a base64 image data URI within the size cap. Returns null to CLEAR the avatar
// (the owner removing it) and undefined when the value is unusable, which leaves the existing
// avatar untouched — so a malformed upload never silently wipes a good one.
export function sanitizeAvatar(raw) {
  if (raw === null || raw === "") return null;
  if (typeof raw !== "string") return undefined;
  const v = raw.trim();
  if (!AVATAR_PREFIX.test(v)) return undefined;
  // Rough decoded size: base64 carries 3 bytes per 4 characters.
  const b64 = v.slice(v.indexOf(",") + 1);
  if (Math.floor((b64.length * 3) / 4) > MAX_AVATAR_BYTES) return undefined;
  return v;
}
