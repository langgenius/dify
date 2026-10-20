import type { ComponentProps } from 'react'
import type { ConsoleQueryTestOptions } from '@/test/console/query-data'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import InstallPluginDropdown from '../install-plugin-dropdown'

const { upload } = vi.hoisted(() => ({ upload: vi.fn() }))
vi.mock('@/service/plugins', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/plugins')>()),
  uploadFile: upload,
}))
// Catalog invalidation is independent of choosing and closing an installer.
vi.mock('../../install-plugin/hooks/use-refresh-plugin-list', () => ({
  default: () => ({ refreshPluginList: vi.fn() }),
}))
const renderDropdown = (
  props: Partial<ComponentProps<typeof InstallPluginDropdown>> = {},
  systemFeatures: ConsoleQueryTestOptions['systemFeatures'] = { enable_marketplace: true },
) => {
  const onSwitchToMarketplaceTab = vi.fn()
  return {
    ...renderWithConsoleQuery(
      <InstallPluginDropdown onSwitchToMarketplaceTab={onSwitchToMarketplaceTab} {...props} />,
      { systemFeatures },
    ),
    onSwitchToMarketplaceTab,
  }
}
const openMenu = async (
  user: ReturnType<typeof userEvent.setup>,
  name = 'plugin.installPlugin',
) => {
  await user.click(screen.getByRole('button', { name }))
}

it('offers all enabled installation sources and switches to the marketplace', async () => {
  const user = userEvent.setup()
  const { onSwitchToMarketplaceTab } = renderDropdown({ triggerLabel: 'Install' })
  await openMenu(user, 'Install')
  expect(screen.getByRole('menuitem', { name: 'plugin.source.github' })).toBeInTheDocument()
  expect(screen.getByRole('menuitem', { name: 'plugin.source.local' })).toBeInTheDocument()
  await user.click(screen.getByRole('menuitem', { name: 'plugin.source.marketplace' }))
  expect(onSwitchToMarketplaceTab).toHaveBeenCalledOnce()
})

it('prevents opening the menu or selecting a file while installation is disabled', async () => {
  const user = userEvent.setup()
  const { container, onSwitchToMarketplaceTab } = renderDropdown({ disabled: true })
  const trigger = screen.getByRole('button', { name: 'plugin.installPlugin' })
  expect(trigger).toBeDisabled()
  await user.click(trigger)
  // A native file input has no implicit ARIA role and is activated by the menu action.
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')!
  expect(input).toBeDisabled()
  await user.upload(input, new File(['content'], 'plugin.difypkg'))
  expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(onSwitchToMarketplaceTab).not.toHaveBeenCalled()
  expect(upload).not.toHaveBeenCalled()
})

it('offers only the marketplace when custom installation is restricted', async () => {
  const user = userEvent.setup()
  renderDropdown(
    {},
    {
      enable_marketplace: true,
      plugin_installation_permission: { restrict_to_marketplace_only: true },
    },
  )
  await openMenu(user)
  expect(screen.getByRole('menuitem', { name: 'plugin.source.marketplace' })).toBeInTheDocument()
  expect(screen.queryByRole('menuitem', { name: 'plugin.source.github' })).not.toBeInTheDocument()
  expect(screen.queryByRole('menuitem', { name: 'plugin.source.local' })).not.toBeInTheDocument()
})

it('opens the GitHub installer and returns to the dropdown when it is cancelled', async () => {
  const user = userEvent.setup()
  renderDropdown()
  await openMenu(user)
  await user.click(screen.getByRole('menuitem', { name: 'plugin.source.github' }))
  await screen.findByRole('dialog', { name: 'plugin.installFromGitHub.installPlugin' })
  await user.click(screen.getByRole('button', { name: 'common.operation.close' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  await openMenu(user)
  expect(screen.getByRole('menuitem', { name: 'plugin.source.github' })).toBeInTheDocument()
})

it('passes the selected file to the real installer and permits selecting the same file after closing', async () => {
  const user = userEvent.setup()
  upload.mockRejectedValue(new Error('Upload unavailable'))
  const { container } = renderDropdown()
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')!
  const file = new File(['content'], 'plugin.difypkg')
  const filePicker = vi.spyOn(input, 'click')
  await openMenu(user)
  await user.click(screen.getByRole('menuitem', { name: 'plugin.source.local' }))
  expect(filePicker).toHaveBeenCalledOnce()
  filePicker.mockRestore()
  await user.upload(input, file)
  await screen.findByRole('dialog', { name: 'plugin.installModal.uploadFailed' })
  expect(upload).toHaveBeenCalledExactlyOnceWith(file, false)
  await user.click(screen.getByText('common.operation.close'))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

  await openMenu(user)
  await user.click(screen.getByRole('menuitem', { name: 'plugin.source.local' }))
  await user.upload(input, file)
  await screen.findByRole('dialog', { name: 'plugin.installModal.uploadFailed' })
  expect(upload).toHaveBeenCalledTimes(2)
})
