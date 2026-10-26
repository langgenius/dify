import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { Sort } from '../index'

vi.mock('react-i18next', async () => {
  const { createReactI18nextMock } = await import('@/test/i18n-mock')
  return createReactI18nextMock({
    'common.sorting.sortBy': 'Sort by:',
    'common.sorting.ascending': 'Sort ascending',
    'common.sorting.descending': 'Sort descending',
  })
})

it('keeps long field names readable and the direction action reachable in a narrow RTL layout', async () => {
  await page.viewport(320, 600)
  const label = 'Zeitpunkt der letzten Aktualisierung des Dokuments'
  const onValueChange = vi.fn()
  const screen = await render(
    <div dir="rtl" style={{ display: 'flex', flexDirection: 'column', width: 240 }}>
      <Sort
        items={[{ value: 'updated_at', name: label }]}
        value={{ field: 'updated_at', order: 'desc' }}
        onValueChange={onValueChange}
      />
    </div>,
  )
  const trigger = screen.getByRole('button', { name: `Sort by: ${label}` })
  const direction = screen.getByRole('button', { name: 'Sort ascending' })
  await expect.element(trigger).toBeVisible()
  await expect.element(direction).toBeVisible()
  const triggerBounds = trigger.element().getBoundingClientRect()
  const directionBounds = direction.element().getBoundingClientRect()
  expect(directionBounds.right).toBeLessThanOrEqual(triggerBounds.left)
  expect(triggerBounds.right - directionBounds.left).toBeLessThanOrEqual(240)

  await trigger.click()
  const option = page.getByRole('menuitemradio', { name: label })
  await expect.element(option).toBeVisible()
  const text = page.getByRole('menu').getByText(label, { exact: true }).element()
  const range = document.createRange()
  range.selectNodeContents(text)
  const optionBounds = option.element().getBoundingClientRect()
  for (const line of range.getClientRects()) {
    expect(line.left).toBeGreaterThanOrEqual(optionBounds.left)
    expect(line.right).toBeLessThanOrEqual(optionBounds.right)
    expect(line.top).toBeGreaterThanOrEqual(optionBounds.top)
    expect(line.bottom).toBeLessThanOrEqual(optionBounds.bottom)
  }
  await option.click()
  await expect.element(page.getByRole('menu')).not.toBeInTheDocument()
  await direction.click()
  expect(onValueChange).toHaveBeenLastCalledWith({ field: 'updated_at', order: 'asc' })
})
