import type { ReactElement } from 'react'
import type { SortValue } from '../index'
import { createInstance } from 'i18next'
import { useState } from 'react'
import { I18nextProvider } from 'react-i18next'
import { page, userEvent } from 'vite-plus/test/browser'
import { render as renderBrowser } from 'vitest-browser-react'
import common from '@/i18n/locales/en-US/common.json'
import { Sort } from '../index'

vi.unmock('react-i18next')

async function render(ui: ReactElement) {
  const i18n = createInstance()
  await i18n.init({ lng: 'en-US', resources: { 'en-US': { common } }, keySeparator: false })
  return renderBrowser(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>)
}

function SortOwner<Field extends string | number>({
  items,
  initial,
}: {
  items: readonly { value: Field; name: string }[]
  initial: SortValue<Field>
}) {
  const [sort, setSort] = useState(initial)
  return (
    <>
      <Sort items={items} value={sort} onValueChange={setSort} />
      <output aria-label="Sort value">{JSON.stringify(sort)}</output>
    </>
  )
}

it('keeps the selected field and direction through keyboard selection, menu removal and toggling', async () => {
  await page.viewport(1000, 800)
  const screen = await render(
    <SortOwner
      items={[
        { value: 'created_at', name: 'Date Created' },
        { value: 'name', name: 'Name' },
      ]}
      initial={{ field: 'created_at', order: 'desc' }}
    />,
  )
  const trigger = screen.getByRole('button', { name: /Sort by:/ })
  await userEvent.tab()
  await expect.element(trigger).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect
    .element(screen.getByRole('menuitemradio', { name: 'Date Created' }))
    .toHaveAttribute('aria-checked', 'true')
  await userEvent.keyboard('{ArrowDown}')
  await expect.element(screen.getByRole('menuitemradio', { name: 'Name' })).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect.element(screen.getByRole('menu')).not.toBeInTheDocument()
  await expect.element(trigger).toMatchTextContent(/Name/)
  await expect.element(trigger).toHaveFocus()
  const value = screen.getByRole('status', { name: 'Sort value' })
  await expect.element(value).toHaveTextContent('{"field":"name","order":"desc"}')
  await userEvent.tab()
  const ascending = screen.getByRole('button', { name: 'Sort ascending' })
  await expect.element(ascending).toHaveFocus()
  await ascending.hover()
  await expect
    .element(screen.getByText('Sort ascending', { exact: true }))
    .toHaveTextContent('Sort ascending')
  await userEvent.keyboard('{Enter}')
  await expect.element(value).toHaveTextContent('{"field":"name","order":"asc"}')
  await screen.getByRole('button', { name: 'Sort descending' }).click()
  await expect.element(value).toHaveTextContent('{"field":"name","order":"desc"}')
  await trigger.click()
  await expect
    .element(screen.getByRole('menuitemradio', { name: 'Name' }))
    .toHaveAttribute('aria-checked', 'true')
})

it('retains numeric identifiers through both selection and direction changes', async () => {
  await page.viewport(1000, 800)
  const screen = await render(
    <SortOwner
      items={[
        { value: 0, name: 'First field' },
        { value: 1, name: 'Second field' },
      ]}
      initial={{ field: 0, order: 'desc' }}
    />,
  )
  const value = screen.getByRole('status', { name: 'Sort value' })
  await screen.getByRole('button', { name: 'Sort ascending' }).click()
  await expect.element(value).toHaveTextContent('{"field":0,"order":"asc"}')
  const trigger = screen.getByRole('button', { name: /Sort by:/ })
  await trigger.click()
  await screen.getByRole('menuitemradio', { name: 'Second field' }).click()
  await expect.element(trigger).toMatchTextContent(/Second field/)
  await expect.element(value).toHaveTextContent('{"field":1,"order":"asc"}')
})

it('keeps long field names readable and the direction action reachable in a narrow RTL layout', async () => {
  await page.viewport(320, 600)
  const label = 'Zeitpunkt der letzten Aktualisierung des Dokuments'
  const screen = await render(
    <div dir="rtl" style={{ display: 'flex', flexDirection: 'column', width: 240 }}>
      <SortOwner
        items={[{ value: 'updated_at', name: label }]}
        initial={{ field: 'updated_at', order: 'desc' }}
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
  await expect
    .element(screen.getByRole('status', { name: 'Sort value' }))
    .toHaveTextContent('{"field":"updated_at","order":"asc"}')
})
