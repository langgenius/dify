import type { PluginDetail } from '../../../../types'
import type { ModalStates, VersionTarget } from '../../hooks'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vite-plus/test'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { createPluginDeclarationFixture } from '@/test/fixtures/plugin'
import { PluginSource } from '../../../../types'
import HeaderModals from '../header-modals'

vi.mock('@/service/use-plugins', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/use-plugins')>()),
  usePluginTaskList: () => ({ handleInstallTaskStart: vi.fn() }),
}))

const createPluginDetail = (overrides: Partial<PluginDetail> = {}): PluginDetail => ({
  id: 'test-id',
  created_at: '2024-01-01',
  updated_at: '2024-01-02',
  name: 'Test Plugin',
  plugin_id: 'test-plugin',
  plugin_unique_identifier: 'test-uid',
  declaration: createPluginDeclarationFixture(),
  installation_id: 'install-1',
  tenant_id: 'tenant-1',
  endpoints_setups: 0,
  endpoints_active: 0,
  version: '1.0.0',
  latest_version: '2.0.0',
  latest_unique_identifier: 'new-uid',
  source: PluginSource.marketplace,
  meta: undefined,
  status: 'active',
  deprecated_reason: '',
  alternative_plugin_id: '',
  ...overrides,
})

const createModalStatesMock = (overrides: Partial<ModalStates> = {}): ModalStates => ({
  isShowUpdateModal: false,
  showUpdateModal: vi.fn<() => void>(),
  hideUpdateModal: vi.fn<() => void>(),
  isShowPluginInfo: false,
  showPluginInfo: vi.fn<() => void>(),
  hidePluginInfo: vi.fn<() => void>(),
  isShowDeleteConfirm: false,
  showDeleteConfirm: vi.fn<() => void>(),
  hideDeleteConfirm: vi.fn<() => void>(),
  deleting: false,
  showDeleting: vi.fn<() => void>(),
  hideDeleting: vi.fn<() => void>(),
  ...overrides,
})

const createTargetVersion = (overrides: Partial<VersionTarget> = {}): VersionTarget => ({
  version: '2.0.0',
  unique_identifier: 'new-uid',
  ...overrides,
})

describe('HeaderModals', () => {
  const renderModals = ({
    detail = createPluginDetail(),
    modalStates = createModalStatesMock(),
    isDowngrade = false,
    isAutoUpgradeEnabled = false,
  } = {}) => {
    const onDelete = vi.fn()
    const onUpdatedFromMarketplace = vi.fn()
    render(
      <HeaderModals
        detail={detail}
        modalStates={modalStates}
        targetVersion={createTargetVersion()}
        isDowngrade={isDowngrade}
        isAutoUpgradeEnabled={isAutoUpgradeEnabled}
        onUpdatedFromMarketplace={onUpdatedFromMarketplace}
        onDelete={onDelete}
      />,
    )
    return { onDelete }
  }

  it('shows GitHub repository, release and package in the real information dialog', async () => {
    const user = userEvent.setup()
    const modalStates = createModalStatesMock({ isShowPluginInfo: true })
    renderModals({
      modalStates,
      detail: createPluginDetail({
        source: PluginSource.github,
        meta: { repo: 'owner/repo', version: 'v1.0.0', package: 'test-pkg' },
      }),
    })
    expect(screen.getByRole('dialog', { name: 'plugin.pluginInfoModal.title' })).toBeInTheDocument()
    expect(screen.getByText('https://github.com/owner/repo')).toBeInTheDocument()
    expect(screen.getByText('1.0.0')).toBeInTheDocument()
    expect(screen.getByText('test-pkg')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'common.operation.close' }))
    expect(modalStates.hidePluginInfo).toHaveBeenCalledOnce()
  })

  it.each([PluginSource.marketplace, PluginSource.github])(
    'omits missing repository and package information for %s',
    (source) => {
      renderModals({
        detail: createPluginDetail({ source }),
        modalStates: createModalStatesMock({ isShowPluginInfo: true }),
      })
      expect(screen.queryByText('plugin.pluginInfoModal.repository')).not.toBeInTheDocument()
      expect(screen.queryByText('plugin.pluginInfoModal.packageName')).not.toBeInTheDocument()
      expect(screen.getByText('1.0.0')).toBeInTheDocument()
    },
  )

  it('lets the user cancel deletion without deleting the plugin', async () => {
    const user = userEvent.setup()
    const modalStates = createModalStatesMock({ isShowDeleteConfirm: true })
    const { onDelete } = renderModals({ modalStates })
    expect(screen.getByRole('alertdialog', { name: 'plugin.action.delete' })).toHaveTextContent(
      'Test Plugin',
    )
    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
    expect(modalStates.hideDeleteConfirm).toHaveBeenCalledOnce()
    expect(onDelete).not.toHaveBeenCalled()
  })

  it('prevents cancelling or resubmitting a deletion already in progress', async () => {
    const user = userEvent.setup()
    const modalStates = createModalStatesMock({ isShowDeleteConfirm: true, deleting: true })
    const { onDelete } = renderModals({ modalStates })
    const confirm = screen.getByRole('button', { name: 'common.operation.confirm' })
    const cancel = screen.getByRole('button', { name: 'common.operation.cancel' })
    expect(confirm).toHaveAttribute('aria-disabled', 'true')
    expect(cancel).toBeDisabled()
    await user.click(confirm)
    await user.click(cancel)
    expect(onDelete).not.toHaveBeenCalled()
    expect(modalStates.hideDeleteConfirm).not.toHaveBeenCalled()
  })

  it.each([
    [true, true, true],
    [true, false, false],
    [false, true, false],
  ])(
    'gates downgrade warning on downgrade=%s and auto-upgrade=%s',
    async (isDowngrade, isAutoUpgradeEnabled, warning) => {
      const user = userEvent.setup()
      const modalStates = createModalStatesMock({ isShowUpdateModal: true })
      renderModals({ modalStates, isDowngrade, isAutoUpgradeEnabled })
      if (warning)
        expect(
          screen.getByRole('button', { name: 'plugin.autoUpdate.pluginDowngradeWarning.exclude' }),
        ).toBeInTheDocument()
      else
        expect(screen.getByRole('button', { name: 'plugin.upgrade.upgrade' })).toBeInTheDocument()
      await user.click(
        screen.getByRole('button', {
          name: warning ? 'app.newApp.Cancel' : 'common.operation.cancel',
        }),
      )
      expect(modalStates.hideUpdateModal).toHaveBeenCalledOnce()
    },
  )
})
