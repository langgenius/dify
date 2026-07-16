import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'

type CucumberEmbedding = {
  data?: string
  mime_type?: string
}

type CucumberStep = {
  embeddings?: CucumberEmbedding[]
  hidden?: boolean
  result?: {
    status?: string
  }
}

type CucumberScenario = {
  name?: string
  steps?: CucumberStep[]
  tags?: { name?: string }[]
  type?: string
}

export type CucumberReport = {
  elements?: CucumberScenario[]
  uri?: string
}[]

export type CucumberReportSummary = {
  blockedScenarios: {
    name: string
    tags: string[]
    uri: string
  }[]
  blockedSkipped: number
  failed: number
  other: number
  passed: number
  selected: number
  skipped: number
  unexpectedSkipped: number
}

export type CucumberReportGate = {
  allowedBlockedScenarios: Record<string, string[]>
  maxSkipped: number
  maxUnexpectedSkipped: number
  minPassed: number
  minSelected: number
  profile: string
}

const reportGateProfiles = {
  core: {
    allowedBlockedScenarios: {
      'features/agent-v2/access-point.feature': ['Workflow access shows the referencing workflow'],
      'features/agent-v2/advanced-settings.feature': [
        'Content Moderation keyword preset replies are saved and restored',
      ],
      'features/agent-v2/agent-edit.feature': [
        'Saved orchestration sections are visible on the Agent Edit page',
        'Duplicated Agent inherits configuration without changing the original Agent',
        'Tool states are visible on the Agent Edit page',
        'Dual Knowledge Retrieval settings are visible on the Agent Edit page',
        'Agent Edit opens the same Agent in Agent Console',
      ],
      'features/agent-v2/configure-persistence.feature': [
        'Selecting a stable model in Configure persists after refresh',
        'Persisted Agent v2 instructions remain visible after refresh',
      ],
      'features/agent-v2/knowledge.feature': [
        'Agent decide Knowledge Retrieval settings are saved and restored',
        'Custom query Knowledge Retrieval settings are saved and restored',
        'Removing Knowledge Retrieval clears the saved dataset reference',
      ],
      'features/agent-v2/output-variables.feature': [
        'Workflow Agent v2 output variables persist after refresh',
        'Workflow Agent v2 nested object output variables persist after refresh',
        'Workflow Agent v2 prompt output reference stays synced when renamed',
      ],
      'features/agent-v2/preflight.feature': [
        'Stable chat model is available',
        'Default speech-to-text model is available',
        'Agent-decision chat model is available',
        'Broken chat model is available for recovery scenarios',
        'JSON Replace tool is available',
        'Tavily Search tool is available',
        'Agent knowledge base is available',
        'Indexing knowledge base is available',
        'Full config Agent is available',
        'Full config Agent includes the summary Skill',
        'Full config Agent includes core fixture configuration',
        'Content Moderation Settings is enabled',
        'Tool states Agent is available',
        'Tool states Agent includes tool state fixture configuration',
        'OAuth2 tool Agent includes credential fixture configuration',
        'Dual retrieval Agent is available',
        'Dual retrieval Agent includes dual retrieval fixture configuration',
        'Published Web app Agent exposes Web app access',
        'Backend API-enabled Agent is available',
        'Backend API-enabled Agent exposes API access with a key',
        'Workflow reference Agent is available',
        'Reference workflow is available',
        'Workflow reference Agent is used by the reference workflow',
      ],
      'features/agent-v2/publish.feature': [
        'Publish a configured Agent v2 draft',
        'Publish action follows unpublished changes',
        'Published Agent v2 version remains isolated from draft edits',
        'Restoring a published Agent v2 version shows the restored configuration in Builder',
      ],
      'features/agent-v2/tools.feature': [
        'JSON Replace tool is saved after adding it from the Tools selector',
        'OAuth2 tool credentials stay authorized after Configure autosaves',
      ],
    },
    maxSkipped: 44,
    maxUnexpectedSkipped: 0,
    minPassed: 65,
    minSelected: 109,
  },
  external: {
    allowedBlockedScenarios: {},
    maxSkipped: 0,
    maxUnexpectedSkipped: 0,
    minPassed: 11,
    minSelected: 11,
  },
  'webkit-browser-smoke': {
    allowedBlockedScenarios: {},
    maxSkipped: 0,
    maxUnexpectedSkipped: 0,
    minPassed: 4,
    minSelected: 4,
  },
} satisfies Record<string, Omit<CucumberReportGate, 'profile'>>

export const getCucumberReportGate = (env: NodeJS.ProcessEnv): CucumberReportGate | undefined => {
  const profile = env.E2E_CUCUMBER_REPORT_PROFILE?.trim()
  if (!profile) return undefined

  const gate = reportGateProfiles[profile as keyof typeof reportGateProfiles]
  if (!gate) throw new Error(`Unknown Cucumber report gate profile "${profile}".`)

  return {
    ...gate,
    allowedBlockedScenarios: Object.fromEntries(
      Object.entries(gate.allowedBlockedScenarios).map(([uri, names]) => [uri, [...names]]),
    ),
    profile,
  }
}

const failureStatuses = new Set(['ambiguous', 'failed', 'pending', 'undefined', 'unknown'])

const hasBlockedPrecondition = (steps: CucumberStep[]) =>
  steps
    .filter((step) => !step.hidden && step.result?.status?.toLowerCase() === 'skipped')
    .flatMap((step) => step.embeddings || [])
    .filter((embedding) => embedding.mime_type === 'text/plain' && embedding.data)
    .some((embedding) => {
      const contents = Buffer.from(embedding.data || '', 'base64').toString('utf8')
      return contents.startsWith('Blocked precondition:')
    })

export const summarizeCucumberReport = (report: CucumberReport): CucumberReportSummary => {
  const summary: CucumberReportSummary = {
    blockedScenarios: [],
    blockedSkipped: 0,
    failed: 0,
    other: 0,
    passed: 0,
    selected: 0,
    skipped: 0,
    unexpectedSkipped: 0,
  }

  for (const feature of report) {
    for (const scenario of feature.elements || []) {
      if (scenario.type !== 'scenario') continue

      summary.selected += 1
      const steps = scenario.steps || []
      const statuses = steps
        .map((step) => step.result?.status?.toLowerCase())
        .filter((status): status is string => Boolean(status))

      if (statuses.some((status) => failureStatuses.has(status))) {
        summary.failed += 1
        continue
      }

      if (steps.length === 0 || statuses.length !== steps.length) {
        summary.other += 1
        continue
      }

      if (statuses.includes('skipped')) {
        summary.skipped += 1
        if (hasBlockedPrecondition(steps)) {
          summary.blockedSkipped += 1
          summary.blockedScenarios.push({
            name: scenario.name || '<unnamed scenario>',
            tags: (scenario.tags || []).flatMap((tag) => (tag.name ? [tag.name] : [])),
            uri: feature.uri || '<unknown feature>',
          })
        } else summary.unexpectedSkipped += 1
        continue
      }

      if (statuses.length > 0 && statuses.every((status) => status === 'passed')) {
        summary.passed += 1
        continue
      }

      summary.other += 1
    }
  }

  return summary
}

export const readCucumberReportSummary = async (reportPath: string) => {
  const contents = await readFile(reportPath, 'utf8')
  const report = JSON.parse(contents) as CucumberReport
  return summarizeCucumberReport(report)
}

export const assertCucumberReport = (summary: CucumberReportSummary, gate: CucumberReportGate) => {
  const errors: string[] = []
  const allowedBlockedScenarios = new Set(
    Object.entries(gate.allowedBlockedScenarios).flatMap(([uri, names]) =>
      names.map((name) => `${uri}\0${name}`),
    ),
  )
  const disallowedBlockedScenarios = summary.blockedScenarios.filter(
    (scenario) => !allowedBlockedScenarios.has(`${scenario.uri}\0${scenario.name}`),
  )

  if (summary.selected < gate.minSelected)
    errors.push(`selected scenarios ${summary.selected} is below minimum ${gate.minSelected}`)
  if (summary.passed < gate.minPassed)
    errors.push(`passed scenarios ${summary.passed} is below minimum ${gate.minPassed}`)
  if (summary.skipped > gate.maxSkipped)
    errors.push(`skipped scenarios ${summary.skipped} exceeds maximum ${gate.maxSkipped}`)
  if (summary.unexpectedSkipped > gate.maxUnexpectedSkipped) {
    errors.push(
      `unexpected skipped scenarios ${summary.unexpectedSkipped} exceeds maximum ${gate.maxUnexpectedSkipped}`,
    )
  }
  if (disallowedBlockedScenarios.length > 0) {
    errors.push(
      `blocked scenarios not present in the checked-in allowlist: ${disallowedBlockedScenarios
        .map((scenario) => `${scenario.uri}: ${scenario.name}`)
        .join(', ')}`,
    )
  }
  if (summary.failed > 0) errors.push(`failed scenarios ${summary.failed} exceeds maximum 0`)
  if (summary.other > 0) errors.push(`unclassified scenarios ${summary.other} exceeds maximum 0`)

  if (errors.length > 0)
    throw new Error(
      [
        `Cucumber report gate "${gate.profile}" failed:`,
        ...errors.map((error) => `- ${error}`),
      ].join('\n'),
    )
}

export const formatCucumberReportSummary = (summary: CucumberReportSummary) =>
  [
    `selected=${summary.selected}`,
    `passed=${summary.passed}`,
    `skipped=${summary.skipped}`,
    `blockedSkipped=${summary.blockedSkipped}`,
    `unexpectedSkipped=${summary.unexpectedSkipped}`,
    `failed=${summary.failed}`,
    `other=${summary.other}`,
  ].join(' ')
