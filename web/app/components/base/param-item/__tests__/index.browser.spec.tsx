import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { ParamItemExample } from './param-item-example'

beforeEach(async () => {
  await page.viewport(800, 600)
})

describe('ParamItem', () => {
  it('omits the tooltip trigger when tooltips are disabled', async () => {
    await render(<ParamItemExample noTooltip tip="Hidden tip" />)
    await expect.element(page.getByRole('button', { name: 'Test Param' })).not.toBeInTheDocument()
  })

  it('disables both numeric and slider edits when the parameter is off', async () => {
    await render(<ParamItemExample enable={false} />)
    await expect.element(page.getByRole('textbox', { name: 'Test Param' })).toBeDisabled()
    await expect.element(page.getByRole('slider', { name: 'Test Param' })).toBeDisabled()
  })

  it('applies text edits to the named parameter and its slider', async () => {
    await render(<ParamItemExample />)
    const input = page.getByRole('textbox', { name: 'Test Param' })
    await input.clear()
    await userEvent.keyboard('0.8')
    await expect.element(input).toHaveValue('0.8')
    await expect
      .element(page.getByRole('status', { name: 'Saved parameters' }))
      .toHaveTextContent('{"test_param":0.8}')
    await expect
      .element(page.getByRole('slider', { name: 'Test Param' }))
      .toHaveAttribute('aria-valuetext', '0.8')
  })

  it('allows replacing the minimum with a multi-digit value without saving the empty draft', async () => {
    await render(<ParamItemExample value={1} min={1} max={100} />)
    const input = page.getByRole('textbox', { name: 'Test Param' })
    await input.clear()
    await expect.element(input).toHaveValue('')
    await expect
      .element(page.getByRole('status', { name: 'Saved parameters' }))
      .toHaveTextContent('{"test_param":1}')
    await userEvent.keyboard('20')
    await expect.element(input).toHaveValue('20')
    await expect
      .element(page.getByRole('status', { name: 'Saved parameters' }))
      .toHaveTextContent('{"test_param":20}')
    await expect.element(page.getByRole('slider', { name: 'Test Param' })).toHaveValue('20')
  })

  it('clamps text edits before saving the parameter and updating the slider', async () => {
    await render(<ParamItemExample />)
    const input = page.getByRole('textbox', { name: 'Test Param' })
    await input.clear()
    await userEvent.keyboard('1.5')
    await expect
      .element(page.getByRole('status', { name: 'Saved parameters' }))
      .toHaveTextContent('{"test_param":1}')
    await expect
      .element(page.getByRole('slider', { name: 'Test Param' }))
      .toHaveAttribute('aria-valuetext', '1')
  })

  it('applies the named switch change and disables the parameter controls', async () => {
    await render(<ParamItemExample hasSwitch />)
    const toggle = page.getByRole('switch', { name: 'Test Param' })
    await toggle.click()
    await expect.element(toggle).not.toBeChecked()
    await expect
      .element(page.getByRole('status', { name: 'Enabled parameters' }))
      .toHaveTextContent('{"test_param":false}')
    await expect.element(page.getByRole('textbox', { name: 'Test Param' })).toBeDisabled()
    await expect.element(page.getByRole('slider', { name: 'Test Param' })).toBeDisabled()
  })

  it('applies the increment step to the saved parameter and both controls', async () => {
    await render(<ParamItemExample step={0.1} />)
    await page.getByRole('button', { name: 'Increment value' }).click()
    await expect.element(page.getByRole('textbox', { name: 'Test Param' })).toHaveValue('0.6')
    await expect
      .element(page.getByRole('slider', { name: 'Test Param' }))
      .toHaveAttribute('aria-valuetext', '0.6')
    await expect
      .element(page.getByRole('status', { name: 'Saved parameters' }))
      .toHaveTextContent('{"test_param":0.6}')
  })
})
