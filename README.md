# Daily Delta

AI-powered competitive intelligence platform that monitors companies and generates daily reports. Run autonomous agents against any company's web presence to surface product launches, funding rounds, leadership changes, hiring trends, and more.

---

## Architecture

| Part | Stack | Purpose |
|------|-------|---------|
| **Web App** | Next.js 16, React 19, Tailwind 4, Supabase | Full dashboard — manage companies, view reports, configure signals |
| **Chrome Extension** | Vite 6, React 19, Tailwind 4, Supabase | Side-panel companion — run agents and read reports from any browser tab |
| **Backend** | Next.js API routes, Supabase, Inngest | SSE-streamed agent orchestration, report generation, email delivery |

---

## Web App

### Prerequisites

- Node.js 18+
- A Supabase project
- A Resend account (for email delivery)

### Environment Variables

Create `.env.local` at the repo root:

```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
RESEND_API_KEY=your_resend_api_key
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### Setup & Development

```bash
# Install dependencies
npm install

# Run the development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Build for Production

```bash
npm run build
npm start
```

Deploy to [Vercel](https://vercel.com) — connect the repo and add the environment variables in the Vercel dashboard. The app is configured for zero-config Vercel deployment.

---

## Chrome Extension

The extension is a **Manifest V3 Chrome side panel** that mirrors the web app's run capabilities directly in the browser — no tab switching required. It connects to the same backend API as the web app.

### Why Vite?

The extension uses [Vite](https://vitejs.dev) instead of the Next.js build system for these reasons:

- **No server-side rendering** — Chrome extensions are pure client-side. Next.js adds unnecessary SSR overhead.
- **Multiple entry points** — Vite's Rollup config natively supports building the side panel UI and the background service worker as separate bundles in one pass.
- **Fast HMR during development** — `vite build --watch` rebuilds in milliseconds on any file change, which pairs well with Chrome's "Reload extension" button.
- **IIFE output for service workers** — Chrome Manifest V3 service workers must be classic scripts (not ES modules). Vite bundles to IIFE by default, whereas bundling a Next.js route as a classic SW script requires significant custom config.
- **Tailwind 4 Vite plugin** — The `@tailwindcss/vite` plugin integrates directly without a PostCSS config file, keeping the setup minimal.

### Prerequisites

- Node.js 18+
- Google Chrome (or any Chromium-based browser)
- The web app (or its Vercel deployment) running and accessible

### Environment Variables

Create `extension/.env.local`:

```env
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
VITE_API_BASE=https://your-deployment.vercel.app/api
```

> `VITE_API_BASE` should point to your deployed web app's `/api` prefix — e.g. `https://daily-delta2.vercel.app/api` for production or `http://localhost:3000/api` for local development.

### Build the Extension

```bash
cd extension

# Install dependencies (first time only)
npm install

# Production build → outputs to extension/dist/
npm run build

# Watch mode for development (rebuilds on save)
npm run dev
```

### Load in Chrome

1. Open **chrome://extensions**
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the `extension/dist/` folder
5. Click the Daily Delta icon in the toolbar (or the puzzle piece → Daily Delta) to open the side panel

After any code change, run `npm run build` (or use watch mode), then click the **⟳ refresh** icon on the extension card in chrome://extensions.

### Extension Features

- **Companies tab** — Add companies by URL (auto-detects the current tab's domain), manage custom signals per company, launch agent runs
- **Active Runs tab** — Live agent preview with streaming browser sessions, progress bar, queued run management (up to 2 concurrent runs), Stop / Remove / Dismiss controls
- **Reports tab** — Browse generated intelligence reports with full Markdown rendering
- **Settings tab** — Global signals, workspace management, email frequency, member invitations

### How Runs Work in the Extension

The extension uses a **background service worker** to manage SSE connections independently of whether the side panel is open:

1. Side panel sends `START_RUN` to the service worker with auth token + org ID
2. Service worker checks capacity (`MAX_CONCURRENT_RUNS = 2`). If full, the run is queued
3. SSE stream keeps the service worker alive for the duration of the run
4. Every agent event is persisted to `chrome.storage.local` so state survives panel close/reopen
5. When a run completes, the next queued run starts automatically
6. The side panel re-hydrates state on open and receives live updates via `chrome.runtime.onMessage`

---

## Project Structure

```
daily-delta/
├── src/
│   ├── app/                  # Next.js App Router pages & API routes
│   │   ├── (app)/            # Authenticated app pages
│   │   └── api/              # Backend API routes (run-agents, stop-run, reports…)
│   ├── components/           # Shared React components (AgentCard, UI primitives)
│   ├── lib/
│   │   ├── api/client.ts     # Typed API client + SSE helpers
│   │   ├── context/          # RunsContext — agent run state management
│   │   └── types.ts          # Shared TypeScript types
│   └── services/             # Agent orchestration, report generation
│
└── extension/
    ├── public/
    │   ├── manifest.json     # Chrome Manifest V3
    │   └── icons/            # Extension icons
    ├── src/
    │   ├── api/client.ts     # Extension API client (mirrors web app client)
    │   ├── auth/             # Supabase auth context + login/signup pages
    │   ├── background/
    │   │   └── service-worker.ts  # SW — SSE management, queue, storage
    │   ├── components/
    │   │   ├── AgentCard.tsx # Live agent status card with streaming preview
    │   │   ├── Markdown.tsx  # Lightweight inline Markdown renderer
    │   │   └── TabBar.tsx    # Navigation tab bar
    │   ├── popup/App.tsx     # Root app component
    │   ├── tabs/             # Four main tabs: Companies, ActiveRuns, Reports, Settings
    │   └── styles/global.css # Tailwind entry point
    ├── sidepanel.html        # Extension side panel entry HTML
    ├── vite.config.ts        # Vite build config (side panel + service worker)
    └── package.json
```

---

## Signal System

Signals define what intelligence agents look for. There are two scopes:

- **Global signals** — apply to every company in your workspace (configured in Settings)
- **Company signals** — apply to a specific company only (configured per company card)

Each signal has a name, target URL, and search instructions that guide the agent.

---

## Development Notes

- The web app's `tsconfig.json` excludes the `extension/` directory to prevent Next.js from picking up Chrome-specific globals (`chrome.*`)
- The extension shares the same Supabase project and API as the web app — auth sessions are interoperable
- Agent streaming URLs (live browser session previews) are rendered as iframes inside AgentCard components in both the web app and extension
