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
  allowedBlockedTags: string[]
  maxSkipped: number
  maxUnexpectedSkipped: number
  minPassed: number
  minSelected: number
  profile: string
}

const reportGateProfiles = {
  core: {
    allowedBlockedTags: [
      '@agent-v2-preflight',
      '@feature-gated',
      '@stable-model',
      '@speech-to-text-model',
      '@agent-decision-model',
      '@broken-model',
      '@tool-fixture',
      '@skill-fixture',
      '@knowledge-fixture',
      '@full-config-agent',
      '@tool-states-agent',
      '@oauth-tool-agent',
      '@dual-retrieval-fixture',
      '@backend-api-access',
      '@published-web-app',
      '@workflow-reference',
    ],
    maxSkipped: 44,
    maxUnexpectedSkipped: 0,
    minPassed: 65,
    minSelected: 109,
  },
  external: {
    allowedBlockedTags: [],
    maxSkipped: 0,
    maxUnexpectedSkipped: 0,
    minPassed: 11,
    minSelected: 11,
  },
  'webkit-browser-smoke': {
    allowedBlockedTags: [],
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
    allowedBlockedTags: [...gate.allowedBlockedTags],
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
  const allowedBlockedTags = new Set(gate.allowedBlockedTags)
  const disallowedBlockedScenarios = summary.blockedScenarios.filter(
    (scenario) => !scenario.tags.some((tag) => allowedBlockedTags.has(tag)),
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
      `blocked scenarios without an allowed dependency tag: ${disallowedBlockedScenarios
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
