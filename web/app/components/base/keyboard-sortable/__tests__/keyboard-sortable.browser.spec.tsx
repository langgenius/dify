import { useState } from 'react'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import ConfigSelect from '@/app/components/app/configuration/config-var/config-select'

function Options() {
  const [options, setOptions] = useState(['Alpha', 'Beta', 'Gamma'])
  return (
    <div style={{ width: 400, padding: 32 }}>
      <button type="button">Before options</button>
      <ConfigSelect options={options} onChange={setOptions} />
    </div>
  )
}

it('keeps native focus on reordered options and preserves pointer sorting', async () => {
  // Browser-owned: native Tab, focus after React moves DOM nodes, and SortableJS pointer hit testing.
  await page.viewport(800, 600)
  const screen = await render(<Options />)
  const before = screen.getByRole('button', { name: 'Before options' })
  const alpha = screen.getByRole('button', { name: /common\.sort\.handle.*Alpha/ })
  const beta = screen.getByRole('button', { name: /common\.sort\.handle.*Beta/ })
  const gamma = screen.getByRole('button', { name: /common\.sort\.handle.*Gamma/ })
  const values = () =>
    screen
      .getByRole('textbox')
      .elements()
      .map((input) => (input as HTMLInputElement).value)
  await before.click()
  await userEvent.tab()
  await expect.element(alpha).toHaveFocus()
  const focusStyle = getComputedStyle(alpha.element())
  expect(focusStyle.boxShadow !== 'none' || focusStyle.outlineStyle !== 'none').toBe(true)
  await userEvent.keyboard(' ')
  await expect.element(alpha).toHaveAttribute('aria-pressed', 'true')
  await userEvent.keyboard('{ArrowDown}')
  await expect.poll(values).toEqual(['Beta', 'Alpha', 'Gamma'])
  await expect.element(alpha).toHaveFocus()
  expect(alpha.element().getBoundingClientRect().top).toBeGreaterThan(
    beta.element().getBoundingClientRect().top,
  )
  await userEvent.keyboard('{Enter}')
  await expect.element(alpha).toHaveAttribute('aria-pressed', 'false')
  await expect.element(alpha).toHaveFocus()
  await userEvent.dragAndDrop(alpha, gamma, { targetPosition: { x: 12, y: 23 } })
  await expect.poll(values).toEqual(['Beta', 'Gamma', 'Alpha'])
})
