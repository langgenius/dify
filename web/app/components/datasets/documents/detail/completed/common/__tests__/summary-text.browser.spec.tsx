import { render } from 'vitest-browser-react'
import SummaryText from '../summary-text'

describe('SummaryText layout', () => {
  it('bounds long summaries to six lines while keeping their full content scrollable', async () => {
    const summary = Array.from({ length: 20 }, (_, index) => `Summary line ${index + 1}`).join('\n')
    const screen = await render(
      <div style={{ width: 320 }}>
        <SummaryText value={summary} />
      </div>,
    )

    const textbox = screen.getByRole('textbox', { name: 'datasetDocuments.segment.summary' })
    await expect.element(textbox).toBeVisible()
    const textarea = textbox.element() as HTMLTextAreaElement
    const lineHeight = Number.parseFloat(getComputedStyle(textarea).lineHeight)

    expect(textarea.value).toBe(summary)
    expect(textarea.getBoundingClientRect().height).toBeLessThanOrEqual(lineHeight * 6 + 1)
    expect(textarea.scrollHeight).toBeGreaterThan(textarea.clientHeight)
    textarea.scrollTop = textarea.scrollHeight
    expect(textarea.scrollTop).toBeGreaterThan(0)
  })
})
