import type { UpdateFromGitHubPayload } from '../../../types'
import { useState } from 'react'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import InstallFromGitHub from '../index'

vi.mock('../../hooks', () => ({
  fetchReleases: vi.fn().mockResolvedValue([{ tag_name: 'v1.0.0', assets: [] }]),
  handleUpload: vi.fn(),
}))
vi.mock('../../base/use-get-icon', () => ({
  default: () => ({ getIconUrl: () => '' }),
}))
vi.mock('../../hooks/use-refresh-plugin-list', () => ({
  default: () => ({ refreshPluginList: vi.fn() }),
}))

function InstallHarness({ updatePayload }: { updatePayload?: UpdateFromGitHubPayload }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button onClick={() => setOpen(true)}>Install from GitHub</button>
      {open && (
        <InstallFromGitHub
          updatePayload={updatePayload}
          onClose={() => setOpen(false)}
          onSuccess={vi.fn()}
        />
      )}
    </>
  )
}

// Native focus timing and tab order require the real browser and Dialog lifecycle.
it('focuses the URL on open, supports Tab, and restores focus after Escape', async () => {
  const screen = await render(<InstallHarness />)
  const trigger = screen.getByRole('button', { name: 'Install from GitHub' })
  trigger.element().focus()
  await userEvent.keyboard('{Enter}')
  const url = screen.getByRole('textbox', { name: 'plugin.installFromGitHub.gitHubRepo' })
  await expect.element(url).toHaveFocus()
  await userEvent.keyboard('{Shift>}{Tab}{/Shift}')
  await expect.element(screen.getByRole('button', { name: 'common.operation.close' })).toHaveFocus()
  await userEvent.keyboard('{Tab}')
  await expect.element(url).toHaveFocus()
  await userEvent.keyboard('{Escape}')
  await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
  await expect.element(trigger).toHaveFocus()
})

it('does not refocus the URL when returning from package selection', async () => {
  const screen = await render(<InstallHarness />)
  await screen.getByRole('button', { name: 'Install from GitHub' }).click()
  const url = screen.getByRole('textbox', { name: 'plugin.installFromGitHub.gitHubRepo' })
  await url.fill('https://github.com/owner/repo')
  await screen.getByRole('button', { name: 'plugin.installModal.next' }).click()
  await screen.getByRole('button', { name: 'plugin.installModal.back' }).click()
  await expect.element(url).toHaveValue('https://github.com/owner/repo')
  await expect.element(url).not.toHaveFocus()
  await userEvent.keyboard('{Escape}')
  await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
})

it('keeps default dialog focus when updating without a URL field', async () => {
  const screen = await render(
    <InstallHarness
      updatePayload={{
        originalPackageInfo: {
          id: 'plugin',
          repo: 'owner/repo',
          version: 'v1.0.0',
          package: 'plugin.zip',
          releases: [],
        },
      }}
    />,
  )
  await screen.getByRole('button', { name: 'Install from GitHub' }).click()
  await expect.element(screen.getByRole('textbox')).not.toBeInTheDocument()
  await expect.element(screen.getByRole('button', { name: 'common.operation.close' })).toHaveFocus()
})
