# Vyralist — Creator-Brand Collaboration Marketplace

> **Pre-seed 2026 · Built solo in under 60 days · Zero external capital**

Vyralist is an end-to-end operating system for creator-brand collaboration — connecting micro to mid-tier creators (0–500K followers) with SMB brands through a fully managed campaign workflow with native payments.

---

## The Problem

- **Brands:** Enterprise influencer tools cost $1,000–$2,000/month, built for Fortune 500. SMBs track deals in DMs and spreadsheets.
- **Creators:** 95% of micro-creators (under 500K followers) are ignored by existing platforms. No standardised way to receive briefs, submit content, and get paid in one place.

## The Solution

A transaction-based platform — brands pay per campaign, not per month. Full workflow from campaign posting to creator payment, in one place.
---

## What's in This Repo

### `/brands-app`
Campaign management platform for brands.

**Features:**
- Full onboarding & brand profile management
- Campaign creation with briefing system
- Creator discovery & filtering
- Stripe wallet system (top-ups, campaign funding, payout escrow)
- Real-time messaging with creators
- Offer management & campaign tracking

### `/creator-app`
Mobile-first PWA for creators. Modular architecture across screens, components, and services.

**Features:**
- Campaign discovery feed with one-tap application flow
- Task management with video upload (Supabase signed URLs)
- Real-time messaging with typing indicators & read receipts
- Earnings dashboard with payout history & referral tracking
- Push notifications via Supabase Realtime
- Full profile & portfolio system

> **Admin Dashboard** source is maintained in a private repository.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | HTML · CSS · Vanilla JavaScript |
| Backend / DB | Supabase (Auth · PostgreSQL · Realtime · RLS · Storage) |
| Payments | Stripe (payments · webhooks · payout pipeline) |
| Deployment | Netlify · CI/CD |
| Database | PostgreSQL with Row-Level Security |

---

## Local Setup

### 1. Clone the repo
```bash
git clone https://github.com/raymondkivuva5-sys/vyralist-core.git
cd vyralist-core
```

### 2. Configure environment
```bash
cp env-config.example.js env-config.js
```

Open `env-config.js` and fill in your Supabase credentials:
```js
window.ENV_SUPABASE_URL      = 'https://your-project-id.supabase.co';
window.ENV_SUPABASE_ANON_KEY = 'your-supabase-anon-key';
```

### 3. Run locally
```bash
python3 -m http.server 8000
```

### 4. Database migrations
Run `creator-app/MIGRATION_messaging_rls.sql` against your Supabase project to set up RLS policies for the messaging system.

---

## Business Model

| Video Type | Brand Pays | Creator Earns | Vyralist Keeps |
|---|---|---|---|
| 15s Basic | $99 | $30 | $69 |
| 30s Basic | $139 | $40 | $99 |
| 60s Basic | $169 | $55 | $114 |
| 15s Premium | $149 | $70 | $79 |
| 30s Premium | $189 | $80 | $109 |
| 60s Premium | $219 | $95 | $124 |

**Platform margin: 57–70% per video**

---

## Traction

| Milestone | Date |
|---|---|
| Founded — product development begins | March 2026 |
| Creators App, Brands App, Admin Dashboard — all functional | April 2026 |
| 9 investor applications submitted | May 2026 |
| Baobab Network — Stage Two due diligence, $100K offer at 12.5% | May 2026 |
| VC4A profile live — 76% score, Country Rank 76 | May 2026 |

---

## The Founder

**Raymond Kivuva** — Founder & Full-Stack Developer

- Self-taught developer — no bootcamp, no CS degree, no framework dependency
- Built 3 complete apps solo in under 60 days
- Implemented real-time messaging, RLS security, Stripe payments, payout pipeline
- 70% complete with zero external capital

📧 raymondkivuva.pro@gmail.com
🔗 [linkedin.com/in/raymond-kivuva-599454408](https://linkedin.com/in/raymond-kivuva-599454408)

---

## License

Proprietary. Source code shared publicly for portfolio and evaluation purposes only.

© 2026 Raymond Kivuva / Vyralist
