# ChatKit / Dify Backend

A multi-tenant backend server that connects websites to a chat agent. Each page maps to a different agent via URL-based routing. One backend serves unlimited websites — just add an agent config and embed a script tag or host the full-page chat HTML.

Two providers are supported per agent:

| Provider | `provider` value | Points at | UI |
|---|---|---|---|
| OpenAI ChatKit | `"chatkit"` *(default)* | a workflow ID | OpenAI's ChatKit web component |
| Dify | `"dify"` | a Dify app (cloud or self-hosted) | the built-in streaming UI in `public/dify-chat.js` |

Agents saved without a `provider` field are treated as ChatKit agents, so existing configs keep working unchanged. Dify API keys never reach the browser — the backend proxies the Dify Service API and streams the response back over SSE.

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Project Structure](#project-structure)
- [Setup & Installation](#setup--installation)
- [Configuration](#configuration)
- [API Reference](#api-reference)
- [Integration Guide](#integration-guide)
- [Admin Dashboard](#admin-dashboard)
- [Thread Cleanup](#thread-cleanup)
- [Deployment](#deployment)

---

## Architecture Overview

```
Website A                     Website B (Moodle iframe)
(example.com/support)         (lms.edu embeds chat.html)
      │                              │
      │  <script src=".../widget.min.js"   <iframe src="chat.html">
      │          data-backend="...">
      ▼                              ▼
┌──────────────────────────────────────────┐
│              Fastify Backend              │
│                                           │
│  POST /check        ← Agent exists?       │
│  POST /session      ← Create ChatKit      │
│  POST /last-thread  ← Resume conversation  │
│  GET  /health       ← Health check         │
│  /admin/*           ← Agent management     │
│                                           │
│  agents.json  ← URL/hostname → workflow   │
└─────────────────┬────────────────────────┘
                  │  OpenAI API Key
                  │  (global or per-agent)
                  ▼
      ┌──────────────────────┐
      │   OpenAI ChatKit API  │
      │                       │
      │  - Session creation   │
      │  - Thread management  │
      │  - Message streaming  │
      └──────────────────────┘
```

**How it works:**

1. A user visits a website with the embedded chat widget or full-page chat
2. The widget/page calls `POST /check` to verify an agent is configured for this URL
3. If no agent is found, the widget stays hidden / the page shows an error
4. When the user interacts with the chat, it calls `POST /session` to create a ChatKit session
5. Backend matches the page URL against agent configs and calls OpenAI ChatKit
6. Backend returns a `client_secret` to the frontend
7. Frontend connects directly to OpenAI ChatKit for real-time messaging
8. On reload, `POST /last-thread` auto-resumes the conversation

The backend **never touches messages** — OpenAI ChatKit handles all conversation threading, context, and streaming.

---

## Project Structure

```
openai_chatkit/
├── .env.example                 # Environment variable template
├── package.json                 # Dependencies and scripts
├── public/                      # Static files served by Fastify
│   ├── admin.html               # Admin dashboard UI
│   ├── chat.html                # Full-page chat (downloadable, for iframe embedding)
│   ├── example.html             # Iframe example (embeds chat.html)
│   ├── widget.js                # Embeddable chat widget (source)
│   └── widget.min.js            # Minified widget (built via esbuild)
└── src/                         # Backend source code
    ├── index.js                 # Entry point — loads env, starts server
    ├── server.js                # Fastify app setup (CORS, static, routes)
    ├── config/
    │   └── agents.json          # Agent configuration (auto-created, gitignored)
    ├── lib/
    │   ├── agents.js            # Load/save/find agent configs from JSON file
    │   ├── openai.js            # OpenAI client (supports per-agent API keys)
    │   └── cleanup.js           # Scheduled thread cleanup (daily cron)
    └── routes/
        ├── session.js           # POST /check, POST /session, POST /last-thread
        └── admin.js             # CRUD endpoints for agent management
```

### Key files

| File | Purpose |
|------|---------|
| `src/index.js` | Boots the server, schedules the cleanup cron job |
| `src/server.js` | Configures Fastify with CORS, static file serving, and route registration |
| `src/routes/session.js` | ChatKit session logic — creates ChatKit sessions, retrieves last active thread. `/check` reports which provider a page uses |
| `src/routes/dify.js` | Dify routes — proxies the chat SSE stream, plus stop / history / last-conversation / parameters |
| `src/routes/admin.js` | Admin API for CRUD operations on agents, protected by Bearer token |
| `src/lib/agents.js` | Reads/writes `agents.json`; `findAgent(hostname, pageUrl)` URL matching, `resolveAgent(request)`, `getProvider(agent)` |
| `src/lib/openai.js` | Exports OpenAI client — uses per-agent API key when configured, otherwise falls back to global key |
| `src/lib/dify.js` | Thin Dify Service API client — per-agent base URL and key, streaming and JSON calls |
| `src/lib/cleanup.js` | Runs daily at 3 AM — deletes ChatKit threads older than `THREAD_RETENTION_DAYS` (skips Dify agents) |
| `public/widget.js` | Self-contained chat widget — checks agent, injects bubble/panel, mounts the provider's UI |
| `public/dify-chat.js` | Dependency-free streaming chat UI for Dify agents, used by both the widget and the full-page chat |
| `public/chat.html` | Full-page chat — meant to be downloaded and hosted on the client's server, embedded via iframe |
| `public/admin.html` | Single-page admin dashboard for managing agents, downloading pages, and copying embed snippets |

### Dependencies

| Package | Purpose |
|---------|---------|
| `fastify` | Web framework |
| `@fastify/cors` | CORS middleware |
| `@fastify/static` | Static file serving |
| `@fastify/cookie` | Cookie handling |
| `openai` | OpenAI API client |
| `node-cron` | Scheduled thread cleanup |
| `uuid` | Agent ID generation |
| `dotenv` | Environment variable loading |
| `esbuild` | Widget minification (dev dependency) |

---

## Setup & Installation

### Prerequisites

- Node.js 18+
- An OpenAI API key with ChatKit access
- An OpenAI workflow ID (created in the OpenAI platform)

### 1. Clone and install

```bash
git clone <repo-url>
cd openai_chatkit
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` with your values:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `OPENAI_API_KEY` | Yes | — | Your OpenAI API key. Used as the default key for every agent that doesn't have its own `api_key` set. All ChatKit sessions and thread cleanup calls to OpenAI are signed with this key unless the matched agent provides an override. |
| `ADMIN_PASSWORD` | Yes | — | The bearer token required to log in to the admin dashboard (`/admin.html`) and to call any `/admin/*` API endpoint. Requests without `Authorization: Bearer <ADMIN_PASSWORD>` are rejected with `401`. Pick a long, random value — this is the only thing protecting agent CRUD. |
| `PORT` | No | `3000` | TCP port the Fastify server binds to. Set only if the server needs to bind to a non-default port (e.g. to match a reverse-proxy / subdomain configuration). |
| `THREAD_RETENTION_DAYS` | No | `30` | How many days of conversation history to keep. The daily cleanup job (3:00 AM server time) deletes any ChatKit thread whose `created_at` is older than this value. |
| `COOKIE_SECRET` | No | — | Reserved for cookie signing (the `@fastify/cookie` plugin is installed but not yet wired up). Safe to leave as the placeholder in `.env.example` until cookies are enabled. |
| `AGENTS_CONFIG_PATH` | No | `src/config/agents.json` | Optional override for where the agent configuration JSON is loaded from / written to. Useful if you want to keep `agents.json` outside the app directory (e.g. on a shared volume or in a parent folder so it survives redeploys). |
| `DIFY_BASE_URL` | No | `https://api.dify.ai/v1` | Default Dify Service API base URL for agents with no `dify_base_url` of their own. For a self-hosted instance use `https://dify.your-domain.com/v1` — the `/v1` suffix is required. Only consulted by `provider: "dify"` agents. |
| `DIFY_API_KEY` | No | — | Default Dify **app** API key (`app-...`) for agents with no `dify_api_key` of their own. Because a Dify key is scoped to a single app, this is mostly useful for single-tenant setups; multi-tenant deployments should set the key per agent. |
| `ENABLE_HOSTNAME_FALLBACK` | No | `false` | Set to `true` to let agents configured as a bare host (`localhost:4001`, `example.com`) match any page on that host. Off by default because full-URL agents let one domain host several agents on different paths. |

### 3. Start the server

```bash
# Production
npm start

# Development (auto-restarts on file changes)
npm run dev
```

### 4. Build the widget (after changes to `widget.js`)

```bash
npm run build
```

This minifies `public/widget.js` → `public/widget.min.js` using esbuild.

### 5. Open the admin dashboard

Navigate to `http://localhost:3000/admin.html` and log in with your `ADMIN_PASSWORD`.

---

## Configuration

### Agent Configuration

Agents map a page URL (or hostname) to an agent on a provider. The mapping is stored in `src/config/agents.json` (auto-created on first run, gitignored).

Fields shared by every agent:

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Auto-generated UUID |
| `hostname` | string | Full URL (e.g., `http://example.com/chat`) or hostname (e.g., `example.com`) |
| `name` | string | Human-readable label |
| `provider` | string | *(Optional)* `"chatkit"` (default) or `"dify"` |

ChatKit-only fields:

| Field | Type | Description |
|-------|------|-------------|
| `workflow_id` | string | OpenAI workflow ID (e.g., `wf_69c7fdf...`). Required. |
| `api_key` | string | *(Optional)* Per-agent OpenAI API key — overrides the global `OPENAI_API_KEY` |

Dify-only fields:

| Field | Type | Description |
|-------|------|-------------|
| `dify_api_key` | string | Dify **app** API key (`app-...`). Required. Never sent to the browser. |
| `dify_base_url` | string | *(Optional)* Service API base for this agent — overrides `DIFY_BASE_URL`. Include the `/v1` suffix. |
| `dify_inputs` | object | *(Optional)* Default app variables passed as `inputs` on every message |

Example `agents.json`:

```json
{
  "agents": [
    {
      "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "hostname": "http://www.example.com/support/chat.html",
      "provider": "chatkit",
      "workflow_id": "wf_your_workflow_id_here",
      "name": "Support Bot"
    },
    {
      "id": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
      "hostname": "http://www.example.com/sales/chat.html",
      "provider": "dify",
      "dify_base_url": "https://dify.your-domain.com/v1",
      "dify_api_key": "app-xxxxxxxxxxxxxxxx",
      "name": "Sales Bot"
    }
  ]
}
```

**You can manage agents in three ways:**

1. **Admin dashboard** — `http://your-backend/admin.html`
2. **Admin API** — `POST/PUT/DELETE /admin/agents` (see [API Reference](#api-reference))
3. **Direct file edit** — modify `src/config/agents.json` and restart the server

### URL Matching

When the backend receives a request, it determines which agent to use by matching the page URL:

1. **Full-URL agents** are checked first against the `page_url` sent by the client (from `window.location.href`). The host+port must match, and the page path must start with the agent's path. The most specific (longest) path wins.

2. **Hostname-only agents** (disabled unless `ENABLE_HOSTNAME_FALLBACK=true`) act as catch-all for any page on that host.

**Examples:**

| Agent hostname | Matches | Doesn't match |
|---|---|---|
| `http://example.com/chat` | `/chat`, `/chat/settings` | `/about`, `/` |
| `http://example.com/support/chat.html` | `/support/chat.html` | `/support/other.html` |
| `http://localhost:4001/chat.html` | the page on port `4001` | the same path on port `4002` |
| `example.com` *(hostname fallback disabled)* | Nothing (unless env flag enabled) | — |

The comparison uses the URL's **host**, which includes the port — so two local sites on
different ports resolve to different agents with no extra configuration.

### Local testing with two ports

The backend occupies `:3000`, so serve the test sites elsewhere. Each site hosts its own copy
of `chat.html` with `BACKEND_URL` pointed at the backend:

```bash
npm run dev                       # backend on :3000

mkdir -p /tmp/siteA /tmp/siteB
curl -s localhost:3000/chat.html -o /tmp/siteA/chat.html
curl -s localhost:3000/chat.html -o /tmp/siteB/chat.html
# set BACKEND_URL = "http://localhost:3000" in both copies

npx serve -l 4001 /tmp/siteA      # http://localhost:4001/chat.html
npx serve -l 4002 /tmp/siteB      # http://localhost:4002/chat.html
```

Register `http://localhost:4001/chat.html` → Dify app A and
`http://localhost:4002/chat.html` → Dify app B in the admin dashboard. Verify the routing
without a browser:

```bash
curl -sX POST localhost:3000/check \
  -H 'content-type: application/json' \
  -d '{"page_url":"http://localhost:4001/chat.html"}'
# => {"ok":true,"provider":"dify","name":"Agent A"}
```

---

## API Reference

### Session Endpoints

#### `POST /check`

Lightweight check — verifies if an agent is configured for the given page URL, and reports which provider it uses so the client can mount the right UI. Does **not** create a session.

**Request body:**

```json
{
  "page_url": "http://example.com/chat.html"
}
```

**Success response (`200`):**

```json
{
  "ok": true,
  "provider": "dify",
  "name": "Support Bot"
}
```

**Error response:**

| Status | Body | Cause |
|--------|------|-------|
| `404` | `{ "error": "No agent configured for this hostname" }` | No agent matches the page URL |

---

#### `POST /session`

Creates a new ChatKit session for the requesting page.

**Request body:**

```json
{
  "user_id": "existing-user-uuid",
  "page_url": "http://example.com/chat.html"
}
```

If `user_id` is omitted, the backend generates a new UUID. `page_url` is used for agent matching.

**Success response (`200`):**

```json
{
  "client_secret": "ckses_abc123...",
  "expires_at": 1719500000,
  "user_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `client_secret` | string | Token for initializing ChatKit on the frontend |
| `expires_at` | number | Unix timestamp when the session expires |
| `user_id` | string | The user's UUID (save this to resume conversations later) |

**Error responses:**

| Status | Body | Cause |
|--------|------|-------|
| `404` | `{ "error": "No agent configured for this hostname" }` | No agent matches the page URL |
| `500` | `{ "error": "..." }` | OpenAI API failure |

---

#### `POST /last-thread`

Retrieves the user's most recent active conversation thread for auto-resumption.

**Request body:**

```json
{
  "user_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "page_url": "http://example.com/chat.html"
}
```

**Success response (`200`):**

```json
{
  "thread_id": "thread_abc123..."
}
```

Returns `{ "thread_id": null }` if the user has no active threads.

**Error responses:**

| Status | Body | Cause |
|--------|------|-------|
| `400` | `{ "error": "user_id required" }` | Missing `user_id` in request body |
| `500` | `{ "error": "..." }` | OpenAI API failure |

---

#### `GET /health`

Health check endpoint.

**Response (`200`):**

```json
{
  "status": "ok"
}
```

---

### Dify Endpoints

All Dify routes resolve the agent from `page_url` exactly like the session routes. They return
`404` if no agent matches and `400` if the matched agent is not `provider: "dify"`.

#### `POST /dify/chat`

Sends a message and streams the reply. The Dify Service API's SSE body is forwarded verbatim,
so the client sees Dify's own event types (`message`, `agent_message`, `message_end`, `error`,
`ping`, and the workflow/node events for Chatflow apps).

**Request body:**

```json
{
  "page_url": "http://example.com/chat.html",
  "user_id": "stable-anonymous-id",
  "conversation_id": "prior-conversation-uuid-or-null",
  "query": "How do I reset my password?"
}
```

Omit or null `conversation_id` to start a new conversation — the id arrives on the first event
and should be persisted client-side.

**Success response (`200`):** `text/event-stream`

```
data: {"event":"message","conversation_id":"…","message_id":"…","task_id":"…","answer":"Sure"}

data: {"event":"message","answer":", here's how"}

data: {"event":"message_end","metadata":{…}}
```

**Error responses:**

| Status | Cause |
|--------|-------|
| `400` | Missing `query`, or the matched agent is not a Dify agent |
| `404` | No agent matches the page URL |
| `4xx` / `502` | Dify rejected the request or is unreachable (status is passed through when sane) |

If the browser disconnects mid-stream, the backend aborts the upstream request so the Dify
generation stops too.

---

#### `POST /dify/stop`

Stops an in-flight generation. Body: `{ page_url, task_id, user_id }` → `{ "stopped": true }`.

---

#### `POST /dify/last-conversation`

Most recent conversation for a user — the Dify equivalent of `/last-thread`.
Body: `{ page_url, user_id }` → `{ "conversation_id": "…" }` or `{ "conversation_id": null }`.

---

#### `POST /dify/history`

Prior messages, flattened into chat turns so a reload can repaint the transcript.
Body: `{ page_url, user_id, conversation_id }` →
`{ "messages": [{ "role": "user", "content": "…" }, { "role": "assistant", "content": "…", "id": "…" }] }`.

---

#### `POST /dify/parameters`

The app's opening statement and suggested questions, shown on an empty conversation.
Body: `{ page_url, user_id }` → `{ "opening_statement": "…", "suggested_questions": ["…"] }`.

---

### Admin Endpoints

All admin endpoints require Bearer token authentication:

```
Authorization: Bearer <ADMIN_PASSWORD>
```

Unauthorized requests return `401 Unauthorized`.

---

#### `GET /admin/agents`

List all configured agents. API keys are **never** returned — a `has_custom_key` boolean is included instead.

**Response (`200`):**

```json
{
  "agents": [
    {
      "id": "a1b2c3d4-...",
      "hostname": "http://example.com/chat.html",
      "workflow_id": "wf_abc123...",
      "name": "Support Bot",
      "has_custom_key": true
    }
  ]
}
```

---

#### `POST /admin/agents`

Create a new agent.

**Request body — ChatKit agent:**

```json
{
  "hostname": "http://newsite.example.com/chat.html",
  "name": "New Site Bot",
  "provider": "chatkit",
  "workflow_id": "wf_your_workflow_id",
  "api_key": "sk-proj-optional-key"
}
```

**Request body — Dify agent:**

```json
{
  "hostname": "http://localhost:4001/chat.html",
  "name": "Agent A",
  "provider": "dify",
  "dify_api_key": "app-xxxxxxxxxxxxxxxx",
  "dify_base_url": "https://dify.your-domain.com/v1"
}
```

`hostname` and `name` are always required. `provider` defaults to `"chatkit"`, which additionally requires `workflow_id`; `"dify"` requires `dify_api_key`. The optional key fields (`api_key`, `dify_base_url`) override the corresponding environment defaults for this agent only. The hostname field accepts both full URLs and plain hostnames.

**Success response (`200`):**

API keys are stripped from every response; presence is reported as a boolean instead.

```json
{
  "agent": {
    "id": "generated-uuid",
    "hostname": "http://localhost:4001/chat.html",
    "name": "Agent A",
    "provider": "dify",
    "dify_base_url": "https://dify.your-domain.com/v1",
    "has_custom_key": false,
    "has_dify_key": true
  }
}
```

**Error responses:**

| Status | Body | Cause |
|--------|------|-------|
| `400` | `{ "error": "hostname and name are required" }` | Missing shared fields |
| `400` | `{ "error": "workflow_id is required for chatkit agents" }` | ChatKit agent without a workflow |
| `400` | `{ "error": "dify_api_key is required for dify agents" }` | Dify agent without a key |
| `400` | `{ "error": "provider must be one of: chatkit, dify" }` | Unknown provider |
| `409` | `{ "error": "Agent with this hostname already exists" }` | Duplicate hostname |

---

#### `PUT /admin/agents/:id`

Update an existing agent. Supports partial updates — include only the fields you want to change. Send `api_key` as empty string to remove a custom key.

**Request body (all fields optional):**

```json
{
  "hostname": "http://updated.example.com/chat.html",
  "workflow_id": "wf_new_workflow_id",
  "name": "Updated Bot Name",
  "api_key": "sk-proj-new-key"
}
```

**Success response (`200`):**

```json
{
  "agent": {
    "id": "a1b2c3d4-...",
    "hostname": "http://updated.example.com/chat.html",
    "workflow_id": "wf_new_workflow_id",
    "name": "Updated Bot Name",
    "has_custom_key": true
  }
}
```

**Error response:**

| Status | Body | Cause |
|--------|------|-------|
| `404` | `{ "error": "Agent not found" }` | No agent with the given ID |

---

#### `DELETE /admin/agents/:id`

Delete an agent.

**Success response (`200`):**

```json
{
  "deleted": true
}
```

**Error response:**

| Status | Body | Cause |
|--------|------|-------|
| `404` | `{ "error": "Agent not found" }` | No agent with the given ID |

---

## Integration Guide

There are two ways to add the chatbot to a website: the **embed widget** or a **full-page chat** (recommended for Moodle/iframe embedding).

### Option 1: Embed Widget

The widget adds a floating chat bubble to any website with a single script tag. The widget checks if an agent is configured for the current page URL — if not, it stays hidden.

#### Step 1: Configure the agent

Add an agent with the **full URL** of the page where the widget will appear:

```bash
curl -X POST https://your-backend.com/admin/agents \
  -H "Authorization: Bearer YOUR_ADMIN_PASSWORD" \
  -H "Content-Type: application/json" \
  -d '{
    "hostname": "http://www.yoursite.com/support",
    "workflow_id": "wf_your_workflow_id",
    "name": "Support Bot"
  }'
```

#### Step 2: Add the embed snippet

Add this single line before the closing `</body>` tag on your website:

```html
<script src="https://your-backend.com/widget.min.js" data-backend="https://your-backend.com"></script>
```

Replace `https://your-backend.com` with your backend's URL.

That's it. The widget handles everything else automatically.

#### What the widget does

- Calls `POST /check` to verify an agent exists for the current page — stays hidden if not
- Injects a **chat bubble** button (bottom-right corner, responsive on mobile)
- Opens a **chat panel** (400x600px, full-screen on mobile) when clicked
- Lazy-loads the **ChatKit SDK** from OpenAI's CDN
- Creates sessions **on demand** — only when the user actually sends a message
- Persists **user ID** and **session** in localStorage, scoped per page URL
- **Auto-resumes** the user's last active conversation

#### Widget localStorage keys

Storage keys are scoped by page (hostname + pathname), so different pages maintain independent sessions:

| Key pattern | Example | Purpose |
|---|---|---|
| `chatkit_{host}{path}_uid` | `chatkit_example.com/support_uid` | User ID for this page |
| `chatkit_{host}{path}_session` | `chatkit_example.com/support_session` | Cached session data |

---

### Option 2: Full-Page Chat (Recommended for Moodle)

For a full-page chat experience embedded via iframe (e.g., in Moodle courses).

#### Step 1: Download chat.html

Download `chat.html` from the admin dashboard or directly from `https://your-backend.com/chat.html`.

#### Step 2: Set the backend URL

Open `chat.html` and set `BACKEND_URL` on line 25:

```javascript
var BACKEND_URL = "https://your-backend.com";
```

Leave empty if the page will be hosted on the same origin as the backend.

#### Step 3: Host the file on your server

Upload `chat.html` to your web server (e.g., `www.yoursite.com/ChatKit/chat.html`).

#### Step 4: Configure the agent

Add an agent with the full URL where you hosted the file. You can do this from the **admin dashboard** (recommended) or via the **admin API**.

**Option A: From the admin dashboard (recommended)**

1. Open `https://your-backend.com/admin.html` and log in with your `ADMIN_PASSWORD`.
2. Scroll to the **Add Agent** form and fill in:
   - **Name** — a human-readable label (e.g. `Course Bot`)
   - **Hostname / URL** — the full URL of the hosted `chat.html`, e.g. `http://www.yoursite.com/ChatKit/chat.html`. Paste it exactly as the browser will load it (same scheme, host, and path — trailing `chat.html` included).
   - **Workflow ID** — your OpenAI workflow ID (starts with `wf_`)
   - **API Key** *(optional)* — leave blank to use the global `OPENAI_API_KEY`, or paste a client-specific `sk-...` key to bill this agent separately.
3. Click **Add Agent**. The new agent appears in the list below with a `Default` or `Custom` API-key badge.

To change the workflow ID or API key later, delete the agent and add it again (or use `PUT /admin/agents/:id` directly — see [API Reference](#api-reference)).

**Option B: Via the admin API**

```bash
curl -X POST https://your-backend.com/admin/agents \
  -H "Authorization: Bearer YOUR_ADMIN_PASSWORD" \
  -H "Content-Type: application/json" \
  -d '{
    "hostname": "http://www.yoursite.com/ChatKit/chat.html",
    "workflow_id": "wf_your_workflow_id",
    "name": "Course Bot"
  }'
```

#### Step 5: Embed in Moodle (or any platform)

In Moodle, add a URL resource or use an iframe:

```html
<iframe src="https://www.yoursite.com/ChatKit/chat.html" width="100%" height="600" style="border:none;"></iframe>
```

The browser sends the iframe's own origin (`www.yoursite.com`) as the page URL, so agent matching works correctly — Moodle cannot interfere since the chat runs in a separate document.

#### Full-page chat features

- Calls `POST /check` before showing the chat — displays "Chat not available" if no agent is configured
- Full-viewport `<openai-chatkit>` web component
- Same localStorage persistence and thread resumption as the widget, scoped per page
- Sessions created lazily — only when the user sends a message
- No JavaScript injection required on the host page — works inside Moodle iframes

---

### Multiple Agents on the Same Domain

You can run different agents on different pages of the same website. Each page URL maps to a separate agent:

| Agent hostname | Page | Bot |
|---|---|---|
| `http://www.example.com/support/chat.html` | Support page | Support Bot |
| `http://www.example.com/sales/chat.html` | Sales page | Sales Bot |
| `http://www.example.com/onboarding/chat.html` | Onboarding page | Onboarding Bot |

Each page maintains its own conversation history in localStorage.

---

### Per-Agent API Keys

By default, all agents use the global `OPENAI_API_KEY`. You can override this per agent by providing an `api_key` when creating or updating an agent. This is useful when:

- Different clients provide their own OpenAI API keys
- You want separate billing per agent
- Different agents need access to different OpenAI organizations

The API key is stored securely and **never exposed** in the admin UI or API responses — only a `has_custom_key` indicator is shown.

---

### Integration Checklist

- [ ] OpenAI workflow created and workflow ID noted
- [ ] Agent added via admin dashboard or API (URL matches the page where chat will appear)
- [ ] Widget snippet added OR `chat.html` downloaded, configured, and hosted
- [ ] Backend reachable from the website (check CORS if issues arise)
- [ ] Test: chat appears on the configured page and stays hidden on other pages

---

## Admin Dashboard

The admin dashboard is available at `/admin.html` on your backend.

**Features:**

- Login with `ADMIN_PASSWORD`
- View the **global embed snippet** (copy-paste ready)
- **Download** `chat.html` and `example.html` for hosting
- **Add new agents** with hostname/URL, workflow ID, name, and optional API key
- **Search** agents by name or hostname
- **Paginated** agent list (100 per page)
- **API key indicator** — shows "Custom" or "Default" badge per agent (key is never exposed)
- Delete agents

**Access:** `https://your-backend.com/admin.html`

---

## Thread Cleanup

Old conversation threads are automatically deleted to manage storage on OpenAI's side.

- **Schedule:** Daily at 3:00 AM (server timezone)
- **Retention:** Threads older than `THREAD_RETENTION_DAYS` (default: 30) are deleted
- **Manual run:** `npm run cleanup`

The cleanup iterates through threads and deletes any with a `created_at` timestamp older than the cutoff date. It stops early once it encounters threads within the retention window (assumes ascending order).

---

## Deployment

The backend is currently hosted on a **TMDHosting dedicated server** managed through **cPanel**, with the Node.js process managed by **PM2**. A subdomain (e.g. `chatkit.learncs.eu`) is pointed at a folder on the server, and PM2 keeps the Fastify server running (see [Managing the app with PM2](#managing-the-app-with-pm2) for start/restart commands).

### Server layout

| Piece | Value |
|------|-------|
| Host | TMDHosting dedicated server (cPanel) |
| Process manager | [PM2](https://pm2.keymetrics.io/) (process name: `chatkit-backend`) |
| Subdomain | Created in cPanel → *Domains* → *Subdomains*, pointed at the app folder |
| App folder | A folder created on the server, e.g. `/home/<cpanel-user>/chatkit-backend` |
| Startup file | `src/index.js` |
| Public URL | The subdomain (e.g. `https://chatkit.learncs.eu`) |

### First-time deployment

1. **Create the subdomain in cPanel**
   cPanel → *Domains* → *Create A New Domain*. Point the subdomain at the folder you want the app to live in (e.g. `chatkit-backend`). cPanel will create the folder under your home directory.

2. **Upload / clone the code into that folder**
   Use cPanel's *File Manager*, *Git Version Control*, or the built-in *Terminal* (cPanel → *Advanced* → *Terminal*):
   ```bash
   cd ~/chatkit-backend
   git clone <repo-url> .
   ```

3. **Confirm Node.js and PM2 are available**
   Open cPanel → *Advanced* → *Terminal* and check:
   ```bash
   node --version       # should be 18 or newer
   pm2 --version
   ```
   If PM2 isn't installed, install it globally (see [If PM2 isn't installed](#if-pm2-isnt-installed)).

4. **Install dependencies**
   From cPanel → *Terminal*:
   ```bash
   cd ~/chatkit-backend
   npm install --production
   ```

5. **Create the `.env` file** (see next section).

6. **Start the app with PM2** (see [First-time start](#first-time-start)):
   ```bash
   cd ~/chatkit-backend
   pm2 start src/index.js --name chatkit-backend
   pm2 save
   pm2 startup     # run the sudo command it prints, once, to enable boot-time startup
   ```
   The backend is now live at the subdomain.

### Managing the `.env` file on the server

Because `.env` is gitignored, it must be created directly on the server. The quickest path is cPanel's built-in Terminal + `nano` — no SSH client needed.

1. **Open the Terminal from cPanel**
   Log in to cPanel → *Advanced* → *Terminal*. (If prompted, accept the warning — this drops you into a shell on the server as your cPanel user.)

2. **`cd` into the app folder:**
   ```bash
   cd ~/chatkit-backend
   ```

3. **Open (or create) `.env` with nano:**
   ```bash
   nano .env
   ```

4. **Paste the variables** (see the [Configuration](#configuration) table above for what each one does):
   ```env
   OPENAI_API_KEY=sk-...
   ADMIN_PASSWORD=a-long-random-string
   THREAD_RETENTION_DAYS=30
   COOKIE_SECRET=another-random-string
   ```
   Leave `PORT` unset to use the default (`3000`), or set it explicitly if you've configured the subdomain proxy to a different port.

5. **Save and exit nano:** `Ctrl+O`, `Enter`, then `Ctrl+X`.

6. **Restart the app with PM2** so the new env is picked up:
   ```bash
   pm2 restart chatkit-backend --update-env
   ```
   The `--update-env` flag is required — without it, PM2 keeps the old environment variables in memory and your changes won't take effect.

### Updating the admin password

The admin password is just the `ADMIN_PASSWORD` value in `.env`. To rotate it, use cPanel's built-in Terminal — there's no separate SSH connection needed.

1. **Open the Terminal from cPanel:** log in to cPanel → *Advanced* → *Terminal*.

2. **Move into the app folder:**
   ```bash
   cd ~/chatkit-backend
   ```

3. **Open `.env` in nano:**
   ```bash
   nano .env
   ```

4. **Find the `ADMIN_PASSWORD=` line** and replace the value with the new password:
   ```env
   ADMIN_PASSWORD=your-new-strong-password
   ```

5. **Save and exit nano:** `Ctrl+O` → `Enter` → `Ctrl+X`.

6. **Restart the app with PM2** so the new password takes effect:
   ```bash
   pm2 restart chatkit-backend --update-env
   ```
   (The `--update-env` flag is required so PM2 reloads the new `ADMIN_PASSWORD` from `.env`.)

7. **Log back in** to `https://<your-subdomain>/admin.html` with the new password. Any open admin browser tabs will need to log in again on their next request.

> The admin password is only stored in this file — there's no database, no second place to update. Anyone with cPanel access can open the Terminal and read it, so treat the cPanel login as equally sensitive.

### Updating the code

Open cPanel → *Advanced* → *Terminal* and run:

```bash
cd ~/chatkit-backend
git pull
npm install --production                  # only if dependencies changed
npm run build                             # only if you edited public/widget.js
pm2 restart chatkit-backend --update-env
```

Use `--update-env` any time `.env` may have changed alongside the pull; it's safe to pass even when it hasn't.

### Managing the app with PM2

The backend runs under [PM2](https://pm2.keymetrics.io/), which keeps the Node.js process alive, restarts it on crashes, and survives server reboots. Use PM2 for all start/stop/restart operations instead of `npm start` directly.

#### First-time start

From the app folder, start the server under PM2 and give the process a stable name (`chatkit-backend` is used throughout this doc):

```bash
cd ~/chatkit-backend
pm2 start src/index.js --name chatkit-backend
```

Then save the process list and enable startup-on-boot so PM2 restores the app after a server reboot:

```bash
pm2 save
pm2 startup        # prints a sudo command — run the command it outputs, once
```

Verify it's running:

```bash
pm2 status
```

You should see `chatkit-backend` with status `online`.

#### Restart after changes

After pulling new code or editing `.env`, restart the process so the changes take effect:

```bash
cd ~/chatkit-backend
git pull
npm install --production     # only if dependencies changed
npm run build                # only if you edited public/widget.js
pm2 restart chatkit-backend --update-env
```

The `--update-env` flag is important when you've changed `.env` — without it, PM2 keeps the old environment variables in memory.

#### Common PM2 commands

| Command | Purpose |
|---------|---------|
| `pm2 status` | List all processes and their state |
| `pm2 logs chatkit-backend` | Tail stdout + stderr (Ctrl+C to exit) |
| `pm2 logs chatkit-backend --lines 200` | Show the last 200 log lines |
| `pm2 restart chatkit-backend` | Restart the process |
| `pm2 restart chatkit-backend --update-env` | Restart and reload `.env` |
| `pm2 reload chatkit-backend` | Zero-downtime restart (for cluster mode) |
| `pm2 stop chatkit-backend` | Stop the process (keeps it in the list) |
| `pm2 delete chatkit-backend` | Remove the process from PM2 entirely |
| `pm2 save` | Persist the current process list so it's restored on reboot |
| `pm2 monit` | Live CPU/memory dashboard |

#### If PM2 isn't installed

Install it globally (usually once, as root or with sudo):

```bash
npm install -g pm2
```

### Persisting `agents.json`

`src/config/agents.json` is created on first run and is **gitignored**, so a `git pull` won't clobber it. If you redeploy by wiping the app folder, copy `agents.json` aside first (or set `AGENTS_CONFIG_PATH` to a location outside the app folder in `.env`).

### Deployment checklist

- [ ] Subdomain created in cPanel and pointed at the app folder
- [ ] `npm install --production` completed successfully
- [ ] `.env` created via cPanel → *Terminal* + `nano` with `OPENAI_API_KEY` and `ADMIN_PASSWORD` set
- [ ] App started under PM2 (`pm2 start src/index.js --name chatkit-backend`) and `pm2 save` + `pm2 startup` run so it survives reboots
- [ ] `pm2 status` shows `chatkit-backend` as `online`
- [ ] HTTPS is active on the subdomain (TMDHosting issues AutoSSL certs — verify in cPanel → *SSL/TLS Status*)
- [ ] Agents configured with full URLs matching target pages
- [ ] Widget snippet / `chat.html` points at the correct backend URL
- [ ] Health check passing: `curl https://<your-subdomain>/health`

---

## NPM Scripts

| Command | Description |
|---------|-------------|
| `npm start` | Start the production server |
| `npm run dev` | Start with `--watch` for auto-restart during development |
| `npm run build` | Minify `widget.js` → `widget.min.js` |
| `npm run cleanup` | Manually run thread cleanup |
