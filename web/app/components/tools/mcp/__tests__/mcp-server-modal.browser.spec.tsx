import { useState } from 'react'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import MCPServerModal from '../mcp-server-modal'

vi.mock('react-i18next', async () => {
  const { createReactI18nextMock } = await import('@/test/i18n-mock')
  const { default: tools } = await import('@/i18n/locales/en-US/tools.json')
  const { default: common } = await import('@/i18n/locales/en-US/common.json')
  return createReactI18nextMock({ ...tools, ...common })
})
vi.mock('@/service/use-tools', () => ({
  useCreateMCPServer: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateMCPServer: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useInvalidateMCPServerDetail: () => vi.fn(),
}))

function MCPDialogEntry() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Configure MCP
      </button>
      {open && (
        <MCPServerModal
          appID="app-1"
          show
          onHide={() => setOpen(false)}
          appInfo={{ description: 'An app description' }}
          latestParams={Array.from({ length: 8 }, (_, index) => ({
            variable: `input_${index}`,
            label: `Parameter ${index}`,
            type: 'string',
          }))}
        />
      )}
    </>
  )
}

afterEach(async () => {
  await page.viewport(1280, 720)
})

function expectControlVisible(control: Element, dialogBounds: DOMRect) {
  const bounds = control.getBoundingClientRect()
  expect(bounds.left).toBeGreaterThanOrEqual(dialogBounds.left)
  expect(bounds.right).toBeLessThanOrEqual(dialogBounds.right)
  expect(bounds.top).toBeGreaterThanOrEqual(dialogBounds.top)
  expect(bounds.bottom).toBeLessThanOrEqual(dialogBounds.bottom)
  let top = bounds.top
  let bottom = bounds.bottom
  for (let ancestor = control.parentElement; ancestor; ancestor = ancestor.parentElement) {
    if (/^(?:auto|scroll|hidden|clip)$/.test(getComputedStyle(ancestor).overflowY)) {
      const ancestorBounds = ancestor.getBoundingClientRect()
      top = Math.max(top, ancestorBounds.top)
      bottom = Math.min(bottom, ancestorBounds.bottom)
    }
  }
  expect(bottom - top).toBeGreaterThan(0)
}

it.each([
  [320, 180],
  [320, 640],
  [1280, 400],
])('keeps the form usable at %i × %i and returns focus after Escape', async (width, height) => {
  await page.viewport(width, height)
  const screen = await render(<MCPDialogEntry />)
  const entry = screen.getByRole('button', { name: 'Configure MCP' })
  await entry.click()
  const dialog = page.getByRole('dialog', { name: 'Add description to enable MCP server' })
  await expect.element(dialog).toBeVisible()
  const close = dialog.getByRole('button', { name: 'Close', exact: true })
  await expect.element(close).toHaveFocus()

  const dialogElement = dialog.element()
  const bounds = dialogElement.getBoundingClientRect()
  expect(bounds.left).toBeGreaterThanOrEqual(0)
  expect(bounds.right).toBeLessThanOrEqual(width)
  expect(bounds.top).toBeGreaterThanOrEqual(0)
  expect(bounds.bottom).toBeLessThanOrEqual(height)
  expect(dialogElement.scrollWidth).toBeLessThanOrEqual(dialogElement.clientWidth + 1)
  expectControlVisible(close.element(), bounds)

  await userEvent.tab({ shift: true })
  await expect
    .element(dialog.getByRole('button', { name: 'Enable MCP Server', exact: true }))
    .toHaveFocus()
  expectControlVisible(
    dialog.getByRole('button', { name: 'Enable MCP Server', exact: true }).element(),
    bounds,
  )
  await userEvent.tab()
  await expect.element(close).toHaveFocus()
  expectControlVisible(close.element(), bounds)
  await userEvent.tab()
  const description = dialog.getByRole('textbox', { name: 'Description' })
  await expect.element(description).toHaveFocus()
  expectControlVisible(description.element(), bounds)
  for (let index = 0; index < 8; index++) {
    await userEvent.tab()
    const input = dialog.getByRole('textbox', { name: `Parameter ${index}`, exact: true })
    await expect.element(input).toHaveFocus()
    expectControlVisible(input.element(), bounds)
  }
  await userEvent.tab()
  await expect.element(dialog.getByRole('button', { name: 'Cancel', exact: true })).toHaveFocus()
  expectControlVisible(
    dialog.getByRole('button', { name: 'Cancel', exact: true }).element(),
    bounds,
  )
  await userEvent.keyboard('{Escape}')
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(entry).toHaveFocus()
})
