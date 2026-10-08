import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { CurlImportDialog } from '../curl-import-dialog'

afterEach(() => vi.unstubAllGlobals())

it('keeps Enter as a newline and restores focus with a fresh draft after Cancel and Escape', async () => {
  vi.stubGlobal('BASE_UI_ANIMATIONS_DISABLED', false)
  const onImport = vi.fn()
  const screen = await render(<CurlImportDialog onImport={onImport} readOnly={false} />)
  const trigger = screen.getByRole('button', { name: 'workflowIntegrations.nodes.http.curl.title' })
  const dialog = screen.getByRole('dialog', { name: 'workflowIntegrations.nodes.http.curl.title' })
  const textarea = screen.getByRole('textbox', {
    name: 'workflowIntegrations.nodes.http.curl.title',
  })
  for (const dismissal of ['Cancel', 'Escape']) {
    await trigger.click()
    await expect.element(textarea).toHaveFocus()
    await expect.element(textarea).toHaveValue('')
    await textarea.fill('curl https://example.com')
    await userEvent.keyboard('{Enter}')
    await expect.element(textarea).toHaveValue('curl https://example.com\n')
    await expect.element(dialog).toBeVisible()
    expect(onImport).not.toHaveBeenCalled()
    if (dismissal === 'Cancel')
      await screen.getByRole('button', { name: 'common.operation.cancel' }).click()
    else await userEvent.keyboard('{Escape}')
    await expect.element(dialog).not.toBeInTheDocument()
    await expect.element(trigger).toHaveFocus()
  }
})

it('returns focus to the trigger after a successful import', async () => {
  vi.stubGlobal('BASE_UI_ANIMATIONS_DISABLED', false)
  const onImport = vi.fn()
  const screen = await render(<CurlImportDialog onImport={onImport} readOnly={false} />)
  const trigger = screen.getByRole('button', { name: 'workflowIntegrations.nodes.http.curl.title' })
  await trigger.click()
  const dialog = screen.getByRole('dialog', { name: 'workflowIntegrations.nodes.http.curl.title' })
  await screen
    .getByRole('textbox', { name: 'workflowIntegrations.nodes.http.curl.title' })
    .fill('curl https://example.com')
  await screen.getByRole('button', { name: 'common.operation.save' }).click()

  expect(onImport).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ method: 'get', url: 'https://example.com' }),
  )
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(trigger).toHaveFocus()
})
