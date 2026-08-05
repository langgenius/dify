import type { DifyWorld } from '../../support/world'
import AxeBuilder from '@axe-core/playwright'
import { Then } from '@cucumber/cucumber'
import { expect } from '@playwright/test'

const wcagLevelATags = ['wcag2a', 'wcag21a']

const formatViolations = (violations: Awaited<ReturnType<AxeBuilder['analyze']>>['violations']) =>
  violations
    .map(
      (violation) =>
        `${violation.id} (${violation.impact ?? 'unknown impact'}): ${violation.help}\n${violation.helpUrl}\n${violation.nodes.map((node) => `  - ${node.target.join(' > ')}`).join('\n')}`,
    )
    .join('\n\n')

Then(
  'the current page should have no automatically detectable WCAG Level A violations',
  async function (this: DifyWorld) {
    const results = await new AxeBuilder({ page: this.getPage() })
      .withTags(wcagLevelATags)
      .analyze()

    expect(results.violations, formatViolations(results.violations)).toEqual([])
  },
)
