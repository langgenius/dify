import type { i18n as I18n } from 'i18next'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { Type } from '@/app/components/workflow/nodes/llm/types'
import common from '@/i18n/locales/en-US/common.json'
import workflowAgent from '@/i18n/locales/en-US/workflow-agent.json'
import { SchemaDialog } from '../schema-dialog'

vi.unmock('react-i18next')

let i18n: I18n

beforeEach(async () => {
  i18n = createInstance()
  await i18n.init({
    lng: 'en-US',
    keySeparator: false,
    resources: { 'en-US': { common, workflowAgent } },
  })
})

it('keeps a long schema scrollable and Close reachable on a small viewport', async () => {
  await page.viewport(414, 640)
  const properties = Object.fromEntries(
    Array.from({ length: 50 }, (_, index) => [`property_${index}`, { type: Type.string }]),
  )
  const screen = await render(
    <I18nextProvider i18n={i18n}>
      <SchemaDialog rootName="Profile" schema={{ type: Type.object, properties }} />
    </I18nextProvider>,
  )
  const entry = screen.getByRole('button', { name: 'JSON Schema: Profile' })
  await entry.click()
  const dialog = screen.getByRole('dialog', { name: 'Parameter Schema' })
  const close = dialog.getByRole('button', { name: 'Close' })
  await expect.element(close).toBeVisible()
  const closeBounds = close.element().getBoundingClientRect()
  expect(closeBounds.left).toBeGreaterThanOrEqual(0)
  expect(closeBounds.right).toBeLessThanOrEqual(window.innerWidth)
  expect(closeBounds.top).toBeGreaterThanOrEqual(0)
  expect(closeBounds.bottom).toBeLessThanOrEqual(window.innerHeight)
  await dialog.getByText('property_0').wheel({ delta: { y: 1800 } })
  await expect
    .poll(() => {
      const fieldBounds = dialog.getByText('property_49').element().getBoundingClientRect()
      return fieldBounds.top >= 0 && fieldBounds.bottom <= window.innerHeight
    })
    .toBe(true)
  await close.click()
  await expect.element(dialog).not.toBeInTheDocument()
})

it('shows complete schema names and descriptions on a narrow viewport', async () => {
  await page.viewport(414, 900)
  const description = `Choose the destination used for delivery. ${'Include the full warehouse address. '.repeat(6)}\nReference: ${'warehouse-reference-'.repeat(12)}`
  const nestedDescription =
    'Use the receiving warehouse address, including the building, floor, and loading bay.'
  const fieldName = 'receiving_warehouse_building_floor_and_loading_bay_identifier'
  const screen = await render(
    <I18nextProvider i18n={i18n}>
      <SchemaDialog
        rootName="Profile"
        schema={{
          type: Type.object,
          description,
          properties: {
            destination: {
              type: Type.object,
              description: nestedDescription,
              properties: { [fieldName]: { type: Type.string } },
            },
          },
        }}
      />
    </I18nextProvider>,
  )
  await screen.getByRole('button', { name: 'JSON Schema: Profile' }).click()
  const dialog = screen.getByRole('dialog', { name: 'Parameter Schema' })
  for (const text of [description, nestedDescription, fieldName]) {
    const locator = dialog.getByText(text)
    await expect.element(locator).toBeVisible()
    const content = locator.element()
    const bounds = content.getBoundingClientRect()
    const dialogBounds = dialog.element().getBoundingClientRect()
    expect(bounds.left).toBeGreaterThanOrEqual(dialogBounds.left)
    expect(bounds.right).toBeLessThanOrEqual(dialogBounds.right)
    const range = document.createRange()
    range.selectNodeContents(content)
    for (const line of range.getClientRects()) {
      expect(line.left).toBeGreaterThanOrEqual(bounds.left)
      expect(line.right).toBeLessThanOrEqual(bounds.right)
      expect(line.bottom).toBeLessThanOrEqual(bounds.bottom)
    }
  }
})
