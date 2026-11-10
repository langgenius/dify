import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { ParamItemExample } from './param-item-example'

beforeEach(async () => {
  await page.viewport(800, 600)
})

// Native Tab/arrow input must update the caller and numeric field, not just emit a callback.
it.each([
  { max: 1, min: 0, value: 0.5, sliderValue: '50', next: 0.51, nextSliderValue: '51' },
  { max: 10, min: 1, value: 5, sliderValue: '5', next: 6, nextSliderValue: '6' },
])(
  'keeps keyboard slider edits in parameter units with max=$max',
  async ({ max, min, value, sliderValue, next, nextSliderValue }) => {
    await render(<ParamItemExample value={value} min={min} max={max} />)
    const slider = page.getByRole('slider', { name: 'Test Param' })
    const input = page.getByRole('textbox', { name: 'Test Param' })
    await expect.element(slider).toHaveValue(sliderValue)
    await input.click()
    await userEvent.tab()
    await expect.element(slider).toHaveFocus()
    await userEvent.keyboard('{ArrowRight}')
    await expect.element(input).toHaveValue(String(next))
    await expect.element(slider).toHaveValue(nextSliderValue)
    await expect
      .element(page.getByRole('status', { name: 'Saved parameters' }))
      .toHaveTextContent(JSON.stringify({ test_param: next }))
  },
)
