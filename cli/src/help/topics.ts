import { ENV_REGISTRY } from '@/env/registry'

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
  * Pass --workspace <id> when you need to target a non-default workspace.
  * Use --stream for long-running workflow calls (post-v1.0 milestone).
  * 'difyctl env list' shows every env var difyctl reads.
`

const EXTERNAL_HELP_TEXT = `difyctl: external-SSO bearer onboarding

  Most agents authenticate as a human account (see 'difyctl help account').
  External-SSO bearers (dfoe_) skip the human flow and exchange an upstream
  identity for a Dify token. The CLI surfaces the same commands but a
  smaller dataset:

  1. Acquire a token through your SSO provider (out of band).
  2. Hand it to the CLI:
       difyctl auth login --external --token "$DIFY_TOKEN"

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
    if (v.sensitive)
      out += '      (treat as secret; never echoed)\n'
    out += '\n'
  }
  return out
}

export const TOPICS: readonly HelpTopic[] = [
  {
    name: 'account',
    summary: 'Agent-onboarding text for account bearers (dfoa_)',
    render: () => ACCOUNT_HELP_TEXT,
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
  return TOPICS.find(t => t.name === name)
}
