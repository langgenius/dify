export const EXTERNAL_HELP_TEXT = `difyctl: external-SSO bearer onboarding

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

export function runHelpExternal(): string {
  return EXTERNAL_HELP_TEXT
}
