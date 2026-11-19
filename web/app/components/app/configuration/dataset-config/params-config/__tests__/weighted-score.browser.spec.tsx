import { useState } from 'react'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import WeightedScore from '../weighted-score'

function Weights({ readonly = false }: { readonly?: boolean }) {
  const [value, setValue] = useState({ value: [0.3, 0.7] })
  return (
    <div style={{ width: 400 }}>
      <button>Before weights</button>
      <WeightedScore value={value} onChange={setValue} readonly={readonly} />
      <button>After weights</button>
    </div>
  )
}

it('keeps displayed semantic and keyword weights complementary when the keyboard changes the weight', async () => {
  const screen = await render(<Weights />)
  const slider = screen.getByRole('slider', { name: 'dataset.weightedScore.semantic' })
  await screen.getByRole('button', { name: 'Before weights' }).click()
  await userEvent.tab()
  await expect.element(slider).toHaveFocus()
  await expect
    .element(slider)
    .toHaveAttribute(
      'aria-valuetext',
      'dataset.weightedScore.semantic: 0.3, dataset.weightedScore.keyword: 0.7',
    )
  await userEvent.keyboard('{ArrowRight}')
  await expect.element(slider).toHaveAttribute('aria-valuenow', '0.4')
  await expect
    .element(slider)
    .toHaveAttribute(
      'aria-valuetext',
      'dataset.weightedScore.semantic: 0.4, dataset.weightedScore.keyword: 0.6',
    )
  await expect.element(screen.getByText(/^dataset\.weightedScore\.semantic\s*0.4$/)).toBeVisible()
  await expect.element(screen.getByText(/^0.6\s*dataset\.weightedScore\.keyword$/)).toBeVisible()
  await userEvent.keyboard('{End}')
  await expect.element(slider).toHaveAttribute('aria-valuenow', '1')
  await expect.element(screen.getByText(/^dataset\.weightedScore\.semantic\s*1.0$/)).toBeVisible()
  await expect.element(screen.getByText(/^0\s*dataset\.weightedScore\.keyword$/)).toBeVisible()
})

it('skips readonly weights in native Tab navigation and preserves the configured balance', async () => {
  const screen = await render(<Weights readonly />)
  const slider = screen.getByRole('slider', { name: 'dataset.weightedScore.semantic' })
  await expect.element(slider).toBeDisabled()
  await screen.getByRole('button', { name: 'Before weights' }).click()
  await userEvent.tab()
  await expect.element(screen.getByRole('button', { name: 'After weights' })).toHaveFocus()
  await expect.element(slider).toHaveAttribute('aria-valuenow', '0.3')
  await expect.element(screen.getByText(/^dataset\.weightedScore\.semantic\s*0.3$/)).toBeVisible()
  await expect.element(screen.getByText(/^0.7\s*dataset\.weightedScore\.keyword$/)).toBeVisible()
})
