# xX Trading Journal — PWA

**Where discipline becomes leverage.** Web-based Progressive Web App — works on any phone, tablet, or laptop. No install required. Full offline support via service worker.

---

## Project structure

```
xx-pwa/
├── public/
│   ├── index.html          ← Home / hub
│   ├── login.html          ← Auth: sign in + forgot password
│   ├── register.html       ← Auth: create account
│   ├── lock.html           ← PIN lock screen
│   ├── journal.html        ← Log new trade
│   ├── dashboard.html      ← Stats + calendar + recent trades
│   ├── analytics.html      ← Deep analytics: HTF, TC, execution, session
│   ├── improvement.html    ← Improvement engine + weekly summary
│   ├── profile.html        ← Profile, PIN setup, data backup
│   ├── db.js               ← Supabase client (shared)
│   ├── shared.js           ← Auth guards, toast, bottom nav, sync
│   ├── sw.js               ← Service worker (offline + caching)
│   ├── manifest.json       ← PWA manifest
│   ├── 404.html            ← SPA fallback
│   └── icons/
│       ├── icon-192.png
│       └── icon-512.png
├── vercel.json             ← Vercel deploy config
├── netlify.toml            ← Netlify deploy config
└── README.md
```

---

## Deploy in 3 minutes (Vercel — recommended)

1. Create a free account at https://vercel.com
2. Install Vercel CLI: `npm i -g vercel`
3. From the `xx-pwa/` folder:
   ```bash
   vercel --prod
   ```
4. When prompted:
   - **Root directory**: `public`
   - Framework: `Other`
5. Done. Share the URL with anyone — works on their phone immediately.

### Or drag-and-drop (no CLI)

1. Go to https://vercel.com/new
2. Click **"Browse"** → select the `public/` folder
3. Deploy → done.

---

## Deploy via Netlify

1. Go to https://netlify.com → **Add new site → Deploy manually**
2. Drag the `public/` folder into the Netlify drop zone
3. Done. The `netlify.toml` handles routing automatically.

---

## Install on phone

Once deployed, open the URL in:
- **Android Chrome** → 3-dot menu → "Add to Home Screen" → Install
- **iPhone Safari** → Share button → "Add to Home Screen"

The app will appear as a standalone app icon — no browser chrome, full screen.

---

## Supabase tables required

The app uses your existing Supabase project. Ensure these tables exist:

```sql
-- profiles (already exists in your project)
id uuid primary key references auth.users(id),
name text, trading_style text, bio text, emoji text,
pin_hash text, recovery_question text, recovery_answer_hash text,
updated_at timestamptz

-- trades
id text primary key, user_id uuid references auth.users(id),
pair text, direction text, outcome text,
trade_date date, trade_time text, is_backdated boolean,
timestamp timestamptz, journal_text text, reason text,
execution text, session text, mindset int, execution_rating int,
rule_breaks jsonb, checklist jsonb, mt4_data jsonb, cycle_number int

-- screenshots
id uuid default gen_random_uuid() primary key,
trade_id text references trades(id), user_id uuid references auth.users(id),
name text, annotation text, data text -- base64

-- cycles
id uuid default gen_random_uuid() primary key,
user_id uuid references auth.users(id),
current_cycle int, trades_in_current_cycle int,
completed_cycles jsonb, all_trades jsonb
```

Make sure RLS is enabled on all tables with `user_id = auth.uid()` policies.

---

## MT4 Inbox on web

The web version does not have a live MT4 file-watcher (that requires local Node.js). Options:

1. **Manual prefill**: On the journal page, trades from MT4 inbox can be prefilled by passing `?prefill=1` — or just type the details manually.
2. **Hybrid**: Keep the Electron app on your main PC for the MT4 inbox; use this PWA on phone/tablet for journalling — same Supabase DB, data stays in sync.
3. **MT4 webhook bridge**: Create a small Python/Node.js script on your trading PC that reads the MT4 CSV and POSTs to a Supabase Edge Function → appears in the web app inbox. (Advanced — ask to build this.)

---

## Features

| Feature                  | Web PWA |
|--------------------------|---------|
| Login / Register         | ✅       |
| PIN lock                 | ✅       |
| Trade Journal            | ✅       |
| Screenshot upload        | ✅       |
| Dashboard + Calendar     | ✅       |
| Analytics (HTF, TC, etc) | ✅       |
| Improvement Engine       | ✅       |
| Weekly Summary           | ✅       |
| Export CSV / XLSX / PDF  | ✅       |
| Offline support          | ✅ (SW) |
| Install to home screen   | ✅       |
| Cloud sync (Supabase)    | ✅       |
| MT4 live inbox           | ❌ (see above) |

---

Built with: Vanilla JS · Supabase · Chart.js · Service Worker
