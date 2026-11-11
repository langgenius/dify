import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import common from '@/i18n/locales/en-US/common.json'
import { Sort } from '../index'

vi.unmock('react-i18next')

it('keeps long field names readable and the direction action reachable in a narrow RTL layout', async () => {
  await page.viewport(320, 600)
  const label = 'Zeitpunkt der letzten Aktualisierung des Dokuments'
  const onValueChange = vi.fn()
  const i18n = createInstance()
  await i18n.init({
    lng: 'en-US',
    resources: { 'en-US': { common } },
    keySeparator: false,
  })
  const screen = await render(
    <I18nextProvider i18n={i18n}>
      <div dir="rtl" style={{ display: 'flex', flexDirection: 'column', width: 240 }}>
        <Sort
          items={[{ value: 'updated_at', name: label }]}
          value={{ field: 'updated_at', order: 'desc' }}
          onValueChange={onValueChange}
        />
      </div>
    </I18nextProvider>,
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
