import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { Type } from '@/app/components/workflow/nodes/llm/types'
import { SchemaDialog } from '../schema-dialog'

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next')
  const { createReactI18nextMock } = await import('@/test/i18n-mock')
  const { default: workflowAgent } = await import('@/i18n/locales/en-US/workflow-agent.json')
  return {
    ...actual,
    ...createReactI18nextMock({
      'workflowAgent.nodes.agent.parameterSchema': workflowAgent['nodes.agent.parameterSchema'],
    }),
  }
})

it('keeps a long schema scrollable and Close reachable on a small viewport', async () => {
  await page.viewport(414, 640)
  const properties = Object.fromEntries(
    Array.from({ length: 50 }, (_, index) => [`property_${index}`, { type: Type.string }]),
  )
  const screen = await render(
    <SchemaDialog rootName="Profile" schema={{ type: Type.object, properties }} />,
  )
  const entry = screen.getByRole('button', { name: 'JSON Schema: Profile' })
  await entry.click()
  const dialog = screen.getByRole('dialog', { name: 'Parameter Schema' })
  const close = dialog.getByRole('button', { name: 'common.operation.close' })
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
    />,
  )
  await screen.getByRole('button', { name: 'JSON Schema: Profile' }).click()
  const dialog = screen.getByRole('dialog', { name: 'Parameter Schema' })
  for (const text of [description, nestedDescription, fieldName]) {
    const content = dialog.getByText(text).element()
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
