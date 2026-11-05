import { useState } from 'react'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import TopKItem from '../top-k-item'

vi.mock('@/env', () => ({ env: { NEXT_PUBLIC_TOP_K_MAX_VALUE: 10 } }))

beforeEach(async () => {
  await page.viewport(800, 600)
})

function Settings({ max }: { max?: number }) {
  const [values, setValues] = useState({ top_k: 2 })
  return (
    <>
      <TopKItem
        enable
        value={values.top_k}
        max={max}
        onChange={(key, next) => setValues((previous) => ({ ...previous, [key]: next }))}
      />
      <output aria-label="Saved parameters">{JSON.stringify(values)}</output>
    </>
  )
}

it('keeps numeric edits and native slider keys synchronized within configured top-k bounds', async () => {
  await render(<Settings />)
  const input = page.getByRole('textbox', { name: 'appDebug.datasetConfig.top_k' })
  const slider = page.getByRole('slider', { name: 'appDebug.datasetConfig.top_k' })
  const saved = page.getByRole('status', { name: 'Saved parameters' })
  await page.getByRole('button', { name: 'Increment value' }).click()
  await expect.element(input).toHaveValue('3')
  await expect.element(slider).toHaveValue('3')
  await expect.element(saved).toHaveTextContent('{"top_k":3}')
  await input.click()
  await userEvent.tab()
  await expect.element(slider).toHaveFocus()
  await userEvent.keyboard('{End}')
  await expect.element(input).toHaveValue('10')
  await expect.element(saved).toHaveTextContent('{"top_k":10}')
  await userEvent.keyboard('{ArrowRight}')
  await expect.element(input).toHaveValue('10')
  await expect.element(saved).toHaveTextContent('{"top_k":10}')
  await userEvent.keyboard('{Home}')
  await expect.element(input).toHaveValue('1')
  await expect.element(saved).toHaveTextContent('{"top_k":1}')
  await userEvent.keyboard('{ArrowLeft}')
  await expect.element(input).toHaveValue('1')
  await expect.element(saved).toHaveTextContent('{"top_k":1}')
})

it.each([
  { enable: false, disabled: false },
  { enable: true, disabled: true },
])('makes both top-k editors unavailable with %j', async (props) => {
  await render(<TopKItem {...props} value={2} onChange={vi.fn()} />)
  await expect
    .element(page.getByRole('textbox', { name: 'appDebug.datasetConfig.top_k' }))
    .toBeDisabled()
  await expect
    .element(page.getByRole('slider', { name: 'appDebug.datasetConfig.top_k' }))
    .toBeDisabled()
})

it('applies a feature-specific maximum to native slider edits and the saved top-k', async () => {
  await render(<Settings max={100} />)
  const slider = page.getByRole('slider', { name: 'appDebug.datasetConfig.top_k' })
  await page.getByRole('textbox', { name: 'appDebug.datasetConfig.top_k' }).click()
  await userEvent.tab()
  await expect.element(slider).toHaveFocus()
  await userEvent.keyboard('{End}')
  await expect.element(slider).toHaveValue('100')
  await expect
    .element(page.getByRole('textbox', { name: 'appDebug.datasetConfig.top_k' }))
    .toHaveValue('100')
  await expect
    .element(page.getByRole('status', { name: 'Saved parameters' }))
    .toHaveTextContent('{"top_k":100}')
})
