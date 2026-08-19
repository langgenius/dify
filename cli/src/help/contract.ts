import { ExitCode } from '@/errors/codes'

export type Contract = {
  readonly exitCodes: Readonly<Record<string, string>>
  readonly outputFormats: readonly string[]
  readonly errorEnvelope: {
    readonly description: string
    readonly shape: string
  }
  readonly hitl: {
    readonly description: string
    readonly resume: string
  }
}

const EXIT_CODE_DESCRIPTIONS: Readonly<Record<number, string>> = {
  [ExitCode.Success]:
    'success (also a workflow paused for human input — check stdout for status "paused")',
  [ExitCode.Generic]: 'generic error',
  [ExitCode.Usage]: 'usage error (bad flag / missing arg)',
  [ExitCode.Auth]: 'auth error (not logged in / token expired)',
  [ExitCode.VersionCompat]: 'version / compatibility error',
}

function buildExitCodes(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const code of Object.values(ExitCode))
    out[String(code)] = EXIT_CODE_DESCRIPTIONS[code] ?? 'see docs'
  return out
}

// Single machine-readable source for the cross-command contract an agent
// needs to drive difyctl: exit semantics, output formats, the stderr error
// envelope, and the human-in-the-loop pause protocol.
export const CONTRACT: Contract = {
  exitCodes: buildExitCodes(),
  outputFormats: ['json', 'yaml', 'name', 'wide', 'text'],
  errorEnvelope: {
    description:
      'On failure the error goes to stderr. Under -o json/yaml it is a structured envelope; otherwise a human line.',
    shape:
      '{ "error": { "code": string, "message": string, "hint"?: string, "http_status"?: number, "method"?: string, "url"?: string, "raw_response"?: string, "server"?: object } }',
  },
  hitl: {
    description:
      'When a workflow pauses for human input, `run app` exits 0 (success-with-pending) and writes a JSON object to stdout with status "paused", form_token, workflow_run_id and resolved_default_values.',
    resume:
      'difyctl resume app <app_id> <form_token> --workflow-run-id <id> [--inputs \'{"key":"value"}\']',
  },
}

// Single source for the top-level GLOBAL FLAGS section: flags that work across
// commands. `-o` is parsed globally (see sniffOutputFormat); its accepted values
// come straight from CONTRACT.outputFormats so the two can never drift.
export const GLOBAL_FLAG_HELP: ReadonlyArray<{ label: string; description: string }> = [
  {
    label: '-o, --output <format>',
    description: `Output format: ${CONTRACT.outputFormats.join('|')}`,
  },
  { label: '-v, --verbose', description: 'Enable verbose logging' },
  {
    label: '--http-retry <n>',
    description: 'Retry idempotent GET/PUT/DELETE on transient errors (0 disables)',
  },
]
