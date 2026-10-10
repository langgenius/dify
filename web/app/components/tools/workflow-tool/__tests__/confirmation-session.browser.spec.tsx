import type { WorkflowToolDrawerPayload } from '../index'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { page, userEvent } from 'vite-plus/test/browser'
import { cleanup, render } from 'vitest-browser-react'
import { WorkflowToolDrawer } from '../index'

const payload: WorkflowToolDrawerPayload = {
  icon: { content: '🔧', background: '#ffffff' },
  label: 'Existing workflow tool',
  name: 'existing_tool',
  description: 'Original description',
  parameters: [],
  outputParameters: [],
  labels: [],
  privacy_policy: '',
  workflow_tool_id: 'tool-1',
}

afterEach(async () => {
  await cleanup()
  vi.unstubAllGlobals()
})

it.each([
  { action: 'Escape', width: 1000 },
  { action: 'Cancel', width: 414 },
])(
  'returns from $action to the real Drawer Save without losing its draft at $width px',
  async ({ action, width }) => {
    vi.stubGlobal('BASE_UI_ANIMATIONS_DISABLED', false)
    await page.viewport(width, 760)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const onHide = vi.fn()
    const onSave = vi.fn()
    const screen = await render(
      <QueryClientProvider client={client}>
        <WorkflowToolDrawer payload={payload} onHide={onHide} onSave={onSave} />
      </QueryClientProvider>,
    )
    const name = screen.getByPlaceholder('tools.createTool.toolNamePlaceHolder')
    await name.fill('Edited workflow tool')
    const save = screen.getByRole('button', { name: 'common.operation.save' })
    await save.click()
    const dialog = screen.getByRole('dialog', { name: 'tools.createTool.confirmTitle' })
    await expect.element(dialog).toBeVisible()
    const popup = dialog.element()
    await expect
      .poll(
        () =>
          !popup.hasAttribute('data-starting-style') &&
          popup.getAnimations().every((animation) => animation.playState === 'finished'),
      )
      .toBe(true)
    if (width === 414) {
      const rect = popup.getBoundingClientRect()
      expect(rect.left).toBeGreaterThanOrEqual(16)
      expect(rect.right).toBeLessThanOrEqual(width - 16)
    }
    if (width === 1000) expect(popup.getBoundingClientRect().width).toBe(600)
    let titleDuringExit: string | undefined
    popup.addEventListener('transitionrun', () => {
      if (popup.hasAttribute('data-ending-style'))
        titleDuringExit = popup.querySelector('h2')?.textContent ?? undefined
    })
    if (action === 'Escape') await userEvent.keyboard('{Escape}')
    else await dialog.getByRole('button', { name: 'common.operation.cancel' }).click()
    await expect.element(dialog).not.toBeInTheDocument()
    await expect.poll(() => titleDuringExit).toBe('tools.createTool.confirmTitle')
    await expect.poll(() => popup.isConnected).toBe(false)
    await expect.element(save).toHaveFocus()
    await expect.element(name).toHaveValue('Edited workflow tool')
    expect(onSave).not.toHaveBeenCalled()
    expect(onHide).not.toHaveBeenCalled()
    await userEvent.keyboard('{Enter}')
    await expect.element(dialog).toBeVisible()
    const reopenedPopup = dialog.element()
    await dialog.getByRole('button', { name: 'common.operation.close' }).click()
    await expect.poll(() => reopenedPopup.isConnected).toBe(false)
    await expect.element(save).toHaveFocus()
    client.clear()
  },
)
