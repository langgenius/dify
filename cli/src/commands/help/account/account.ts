export const ACCOUNT_HELP_TEXT = `difyctl: account-bearer onboarding

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

export function runHelpAccount(): string {
  return ACCOUNT_HELP_TEXT
}
