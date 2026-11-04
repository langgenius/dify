import { useState } from 'react'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import ScoreThresholdItem from '../score-threshold-item'

beforeEach(async () => {
  await page.viewport(800, 600)
})

it.each([
  [undefined, '0.7'],
  [-0.1, '0'],
  [1.5, '1'],
  [0.556, '0.56'],
])('normalizes configured threshold %s to %s in both editors', async (value, expected) => {
  await render(<ScoreThresholdItem value={value} enable onChange={vi.fn()} />)
  await expect
    .element(page.getByRole('textbox', { name: 'appDebug.datasetConfig.score_threshold' }))
    .toHaveValue(expected)
  await expect
    .element(page.getByRole('slider', { name: 'appDebug.datasetConfig.score_threshold' }))
    .toHaveAttribute('aria-valuetext', expected)
})

it('saves threshold edits in hundredths and makes both editors unavailable when switched off', async () => {
  function Settings() {
    const [values, setValues] = useState({ score_threshold: 0.5 })
    const [enabled, setEnabled] = useState({ score_threshold: true })
    return (
      <>
        <ScoreThresholdItem
          value={values.score_threshold}
          enable={enabled.score_threshold}
          hasSwitch
          onChange={(key, next) => setValues((previous) => ({ ...previous, [key]: next }))}
          onSwitchChange={(key, next) => setEnabled((previous) => ({ ...previous, [key]: next }))}
        />
        <output aria-label="Saved parameters">{JSON.stringify(values)}</output>
        <output aria-label="Enabled parameters">{JSON.stringify(enabled)}</output>
      </>
    )
  }
  await render(<Settings />)
  const name = 'appDebug.datasetConfig.score_threshold'
  const input = page.getByRole('textbox', { name })
  const slider = page.getByRole('slider', { name })
  const saved = page.getByRole('status', { name: 'Saved parameters' })
  await page.getByRole('button', { name: 'Increment value' }).click()
  await expect.element(input).toHaveValue('0.51')
  await expect.element(slider).toHaveAttribute('aria-valuetext', '0.51')
  await expect.element(saved).toHaveTextContent('{"score_threshold":0.51}')
  await input.clear()
  await userEvent.keyboard('0.55')
  await expect.element(input).toHaveValue('0.55')
  await expect.element(slider).toHaveAttribute('aria-valuetext', '0.55')
  await expect.element(saved).toHaveTextContent('{"score_threshold":0.55}')
  // Return through the real tab order rather than imperatively focusing the switch.
  await userEvent.tab({ shift: true })
  await expect.element(page.getByRole('button', { name })).toHaveFocus()
  await userEvent.tab({ shift: true })
  const toggle = page.getByRole('switch', { name })
  await expect.element(toggle).toHaveFocus()
  await userEvent.keyboard(' ')
  await expect.element(toggle).not.toBeChecked()
  await expect
    .element(page.getByRole('status', { name: 'Enabled parameters' }))
    .toHaveTextContent('{"score_threshold":false}')
  await expect.element(input).toBeDisabled()
  await expect.element(slider).toBeDisabled()
  await expect.element(saved).toHaveTextContent('{"score_threshold":0.55}')
})
