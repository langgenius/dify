import { render } from 'vitest-browser-react'
import SummaryText from '../summary-text'

describe('SummaryText layout', () => {
  it('keeps segment content visible and the summary scrollable when it exceeds six lines', async () => {
    const summary = Array.from({ length: 20 }, (_, index) => `Summary line ${index + 1}`).join('\n')
    const screen = await render(
      <div style={{ display: 'flex', flexDirection: 'column', height: 320, width: 320 }}>
        <div data-testid="segment-content" style={{ flex: '1 1 0', minHeight: 0 }} />
        <div style={{ flexShrink: 0 }}>
          <SummaryText value={summary} />
        </div>
      </div>,
    )

    const textbox = screen.getByRole('textbox', { name: 'datasetDocuments.segment.summary' })
    await expect.element(textbox).toBeVisible()
    const textarea = textbox.element() as HTMLTextAreaElement
    const lineHeight = Number.parseFloat(getComputedStyle(textarea).lineHeight)

    expect(textarea.getBoundingClientRect().height).toBeLessThanOrEqual(lineHeight * 6 + 1)
    expect(textarea.scrollHeight).toBeGreaterThan(textarea.clientHeight)
    expect(
      screen.getByTestId('segment-content').element().getBoundingClientRect().height,
    ).toBeGreaterThan(0)

    textarea.scrollTop = textarea.scrollHeight
    expect(textarea.scrollTop).toBeGreaterThan(0)
  })
})
