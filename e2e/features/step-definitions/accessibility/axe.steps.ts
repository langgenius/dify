import type { DifyWorld } from '../../support/world'
import AxeBuilder from '@axe-core/playwright'
import { Then } from '@cucumber/cucumber'
import { expect } from '@playwright/test'

type AxeResults = Awaited<ReturnType<AxeBuilder['analyze']>>
type WcagLevel = 'A' | 'AA'

const wcagTagsByLevel = {
  A: ['wcag2a', 'wcag21a'],
  AA: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
} satisfies Record<WcagLevel, string[]>

const formatFindings = (findings: AxeResults['violations']) =>
  findings
    .map(
      (violation) =>
        `${violation.id} (${violation.impact ?? 'unknown impact'}): ${violation.help}\n${violation.helpUrl}\n${violation.nodes.map((node) => `  - ${node.target.join(' > ')}${node.failureSummary ? `\n    ${node.failureSummary.replaceAll('\n', '\n    ')}` : ''}`).join('\n')}`,
    )
    .join('\n\n')

const checkCurrentPage = async (world: DifyWorld, level: WcagLevel) => {
  const results = await new AxeBuilder({ page: world.getPage() })
    .withTags(wcagTagsByLevel[level])
    .analyze()
  const formattedViolations = formatFindings(results.violations)
  const formattedIncomplete = formatFindings(results.incomplete)

  if (results.violations.length > 0) {
    world.attach(
      `WCAG Level ${level} violations for ${results.url}:\n\n${formattedViolations}`,
      'text/plain',
    )
  }

  if (results.incomplete.length > 0) {
    world.attach(
      `WCAG Level ${level} items requiring manual review for ${results.url}:\n\n${formattedIncomplete}`,
      'text/plain',
    )
  }

  if (results.violations.length > 0 || results.incomplete.length > 0)
    world.attach(
      JSON.stringify(
        {
          incomplete: results.incomplete,
          level,
          url: results.url,
          violations: results.violations,
        },
        null,
        2,
      ),
      'application/json',
    )

  expect(results.violations, formattedViolations).toEqual([])
}

Then(
  'the current page should have no automatically detectable WCAG Level {word} violations',
  async function (this: DifyWorld, level: string) {
    if (!Object.hasOwn(wcagTagsByLevel, level))
      throw new Error(`Unsupported WCAG level "${level}". Expected A or AA.`)

    await checkCurrentPage(this, level as WcagLevel)
  },
)
