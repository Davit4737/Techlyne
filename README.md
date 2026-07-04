# BizAssist

The AI front desk that never sleeps — answers clients, books appointments, and sends reminders 24/7.
Landing page + serverless AI chat, deployed on Vercel.

Live: [bizzassist.xyz](https://bizzassist.xyz)

## Project structure

```
index.html        Landing page (single file) with a LIVE interactive chat demo
api/chat.js        Serverless AI endpoint → Anthropic Claude (dependency-free)
vercel.json        Vercel config
.env.example       Reference for required environment variables
```

## Setup (2 things to turn on)

### 1. AI chat — add your Anthropic key
The live chat demo on the landing page calls `/api/chat`, which needs an Anthropic API key.

1. Get a key at <https://console.anthropic.com>
2. In Vercel → your project → **Settings → Environment Variables**, add:
   - `ANTHROPIC_API_KEY` = `sk-ant-...`
3. Redeploy. The chat box in the hero demo now gives real AI answers.

Model is set in `api/chat.js` (`MODEL` constant) — currently `claude-sonnet-4-5`.

### 2. Email capture — connect Formspree
The waitlist forms fall back to `localStorage` until you connect Formspree (free, no backend needed).

1. Create a free form at <https://formspree.io> and copy its endpoint (looks like `https://formspree.io/f/abcdwxyz`)
2. In `index.html`, find `FORMSPREE_ENDPOINT` and replace `YOUR_FORM_ID` with your real endpoint
3. Commit + push. Signups now land in your Formspree inbox.

## Local notes

- No build step, no `npm install` — `api/chat.js` uses plain `fetch`, no dependencies.
- Rate limiting in `api/chat.js` is in-memory (per warm instance). For real per-customer quotas, back it with a database/Redis later.

## Roadmap

- [x] Landing page + live AI chat demo
- [ ] Appointment booking + calendar sync
- [ ] SMS/email reminders (Twilio / Resend)
- [ ] Business dashboard (conversations + bookings)
- [ ] Per-customer usage tracking & rate limiting
