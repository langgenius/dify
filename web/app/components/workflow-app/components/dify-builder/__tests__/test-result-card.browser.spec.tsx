import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { TestResultCard } from '../conversation/test-result-card'

describe('Builder final result scrolling', () => {
  // Real layout and native keyboard scrolling prove that a complete long result
  // stays readable inside the card. The unit project cannot measure clipping.
  it('keeps a failed run’s long output within the card and lets keyboard users reach the end', async () => {
    await page.viewport(420, 800)
    const report = [
      '# Partial report',
      ...Array.from({ length: 80 }, (_, index) => `Processed record ${index + 1}.`),
      'x'.repeat(500),
      '## Final conclusion',
      'Final result preserved.',
    ].join('\n\n')
    const screen = await render(
      <div className="w-92">
        <TestResultCard
          payload={{
            status: 'failed',
            failure_reason: 'The next step timed out.',
            terminal_outputs: { report },
          }}
          invalidated={false}
        />
      </div>,
    )
    const output = screen.getByRole('region', {
      name: 'workflow.difyBuilder.testResult.terminalOutputs',
    })
    await expect.element(screen.getByRole('heading', { name: 'Partial report' })).toBeVisible()
    await expect.element(screen.getByText('The next step timed out.')).toBeVisible()
    const viewport = output.element()
    expect(viewport.scrollHeight).toBeGreaterThan(viewport.clientHeight)
    expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.clientWidth)

    await userEvent.tab()
    await expect.element(output).toHaveFocus()
    await userEvent.keyboard('{End}')
    await expect
      .poll(() => viewport.scrollTop + viewport.clientHeight >= viewport.scrollHeight - 1)
      .toBe(true)
    const conclusion = screen.getByText('Final result preserved.').element().getBoundingClientRect()
    const bounds = viewport.getBoundingClientRect()
    expect(conclusion.top).toBeGreaterThanOrEqual(bounds.top)
    expect(conclusion.bottom).toBeLessThanOrEqual(bounds.bottom)
  })
})
