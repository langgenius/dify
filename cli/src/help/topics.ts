import { ENV_REGISTRY } from '@/env/registry'
import { CONTRACT } from './contract'

export type HelpTopic = {
  readonly name: string
  readonly summary: string
  readonly render: () => string
}

const ACCOUNT_HELP_TEXT = `difyctl: account-bearer onboarding

  1. Sign in interactively (browser device flow):
       difyctl auth login

  2. List accessible apps in your default workspace:
       difyctl get app

  3. Describe one app to see its parameters:
       difyctl describe app <id>

  4. Run an app and capture structured output:
       difyctl run app <id> "hello" -o json

Tips:
  * Two app nouns: 'studio-app' is what you build and edit in Studio on the
    web console inside a workspace (its source definition — export or move it);
    'app' is a published app you run and inspect.
  * 'difyctl auth list' shows your authenticated contexts; 'difyctl use host'
    and 'difyctl use account' switch between them.
  * Pass --workspace <id> to target a non-default workspace.
  * Pass --stream to 'difyctl run app' for live token/event output.
  * 'difyctl env list' shows every env var difyctl reads.
`

const EXTERNAL_HELP_TEXT = `difyctl: external-SSO bearer onboarding

  Most agents authenticate as a human account (see 'difyctl help account').
  External-SSO bearers (dfoe_) skip the human flow and exchange an upstream
  identity for a Dify token. The CLI surfaces the same commands but a
  smaller dataset:

  1. Acquire a token through your SSO provider (out of band).
  2. Hand it to the CLI via the DIFY_TOKEN environment variable:
       export DIFY_TOKEN="<your-token>"

  3. List apps your subject is permitted to invoke:
       difyctl get app

  4. Run an app:
       difyctl run app <id> "hello" -o json

Notes:
  * 'difyctl get workspace' returns an empty list for external bearers — that
    is expected; external subjects have no workspace membership.
  * Tokens are best stored in DIFY_TOKEN; difyctl reads it on every command.
`

function renderEnvironment(): string {
  let out = 'ENVIRONMENT VARIABLES\n\n'
  for (const v of ENV_REGISTRY) {
    out += `  ${v.name}\n      ${v.description}\n`
    if (v.sensitive) out += '      (treat as secret; never echoed)\n'
    out += '\n'
  }
  return out
}

function renderAgent(): string {
  const exitCodes = Object.entries(CONTRACT.exitCodes)
    .map(([code, desc]) => `  ${code}  ${desc}`)
    .join('\n')

  return `difyctl: agent operating guide

OUTPUT
  Pass -o json (or -o yaml) on every command — the JSON shape is stable and
  documented. Without it you get human tables meant for a terminal.

APP vs STUDIO-APP
  Two nouns, two faces of the same app:
    studio-app   what you build and edit in Studio on the web console,
                 inside a workspace — the app's source definition.
    app          a published app, live and runnable.
  Use 'studio-app' to work with the definition you manage on the website
  (export it, move it between workspaces or instances); use 'app' to run
  and inspect a published one. The COMMANDS list shows the verbs each
  noun supports.

DISCOVERY
  difyctl help -o json        full command tree + this contract, machine-readable
  difyctl get app -o json     list apps (ids + modes)
  difyctl describe app <id>   one app's mode and input schema

AUTH
  Interactive:     difyctl auth login         (browser device flow)
  Non-interactive: export DIFY_TOKEN=<bearer>  (read on every command)
  Details:         difyctl help account / difyctl help external

EXIT CODES
${exitCodes}

ERRORS
  Under -o json/yaml a failure writes a structured envelope to stderr:
    ${CONTRACT.errorEnvelope.shape}

HUMAN-IN-THE-LOOP
  ${CONTRACT.hitl.description}
  Resume: ${CONTRACT.hitl.resume}

RETRY
  Idempotent GET/PUT/DELETE retry on transient errors (default 3); POST/PATCH
  never. Override with --http-retry <n> or DIFYCTL_HTTP_RETRY.
`
}

export const TOPICS: readonly HelpTopic[] = [
  {
    name: 'account',
    summary: 'Agent-onboarding text for account bearers (dfoa_)',
    render: () => ACCOUNT_HELP_TEXT,
  },
  {
    name: 'agent',
    summary: 'Cross-command contract for agents driving difyctl',
    render: renderAgent,
  },
  {
    name: 'environment',
    summary: 'Long-form documentation for every DIFY_* env var',
    render: renderEnvironment,
  },
  {
    name: 'external',
    summary: 'Agent-onboarding text for external-SSO bearers (dfoe_)',
    render: () => EXTERNAL_HELP_TEXT,
  },
]

export function findTopic(name: string): HelpTopic | undefined {
  return TOPICS.find((t) => t.name === name)
}
