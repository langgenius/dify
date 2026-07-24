import type { PluginDetail } from '../../../../types'
import type { ModalStates, VersionTarget } from '../../hooks'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PluginSource } from '../../../../types'
import HeaderModals from '../header-modals'

vi.mock('@/context/i18n', () => ({
  useGetLanguage: () => 'en_US',
}))

vi.mock('@/app/components/base/confirm', () => ({
  default: ({ isShow, title, onCancel, onConfirm, isLoading }: {
    isShow: boolean
    title: string
    onCancel: () => void
    onConfirm: () => void
    isLoading: boolean
  }) => isShow
    ? (
        <div data-testid="delete-confirm">
          <div data-testid="delete-title">{title}</div>
          <button data-testid="confirm-cancel" onClick={onCancel}>Cancel</button>
          <button data-testid="confirm-ok" onClick={onConfirm} disabled={isLoading}>Confirm</button>
        </div>
      )
    : null,
}))

vi.mock('@/app/components/plugins/plugin-page/plugin-info', () => ({
  default: ({ repository, release, packageName, onHide }: {
    repository: string
    release: string
    packageName: string
    onHide: () => void
  }) => (
    <div data-testid="plugin-info">
      <div data-testid="plugin-info-repo">{repository}</div>
      <div data-testid="plugin-info-release">{release}</div>
      <div data-testid="plugin-info-package">{packageName}</div>
      <button data-testid="plugin-info-close" onClick={onHide}>Close</button>
    </div>
  ),
}))

vi.mock('@/app/components/plugins/update-plugin/from-market-place', () => ({
  default: ({ pluginId, onSave, onCancel, isShowDowngradeWarningModal }: {
    pluginId: string
    onSave: () => void
    onCancel: () => void
    isShowDowngradeWarningModal: boolean
  }) => (
    <div data-testid="update-modal">
      <div data-testid="update-plugin-id">{pluginId}</div>
      <div data-testid="update-downgrade-warning">{String(isShowDowngradeWarningModal)}</div>
      <button data-testid="update-modal-save" onClick={onSave}>Save</button>
      <button data-testid="update-modal-cancel" onClick={onCancel}>Cancel</button>
    </div>
  ),
}))

const createPluginDetail = (overrides: Partial<PluginDetail> = {}): PluginDetail => ({
  id: 'test-id',
  created_at: '2024-01-01',
  updated_at: '2024-01-02',
  name: 'Test Plugin',
  plugin_id: 'test-plugin',
  plugin_unique_identifier: 'test-uid',
  declaration: {
    author: 'test-author',
    name: 'test-plugin-name',
    category: 'tool',
    label: { en_US: 'Test Plugin Label' },
    description: { en_US: 'Test description' },
    icon: 'icon.png',
    verified: true,
  } as unknown as PluginDetail['declaration'],
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
  let mockOnUpdatedFromMarketplace: () => void
  let mockOnDelete: () => void

  beforeEach(() => {
    vi.clearAllMocks()
    mockOnUpdatedFromMarketplace = vi.fn<() => void>()
    mockOnDelete = vi.fn<() => void>()
  })

  describe('Plugin Info Modal', () => {
    it('should not render plugin info modal when isShowPluginInfo is false', () => {
      const modalStates = createModalStatesMock({ isShowPluginInfo: false })
      render(
        <HeaderModals
          detail={createPluginDetail()}
          modalStates={modalStates}
          targetVersion={createTargetVersion()}
          isDowngrade={false}
          isAutoUpgradeEnabled={false}
          onUpdatedFromMarketplace={mockOnUpdatedFromMarketplace}
          onDelete={mockOnDelete}
        />,
      )

      expect(screen.queryByTestId('plugin-info')).not.toBeInTheDocument()
    })

    it('should render plugin info modal when isShowPluginInfo is true', () => {
      const modalStates = createModalStatesMock({ isShowPluginInfo: true })
      render(
        <HeaderModals
          detail={createPluginDetail()}
          modalStates={modalStates}
          targetVersion={createTargetVersion()}
          isDowngrade={false}
          isAutoUpgradeEnabled={false}
          onUpdatedFromMarketplace={mockOnUpdatedFromMarketplace}
          onDelete={mockOnDelete}
        />,
      )

      expect(screen.getByTestId('plugin-info')).toBeInTheDocument()
    })

    it('should pass GitHub repo to plugin info for GitHub source', () => {
      const modalStates = createModalStatesMock({ isShowPluginInfo: true })
      const detail = createPluginDetail({
        source: PluginSource.github,
        meta: { repo: 'owner/repo', version: 'v1.0.0', package: 'test-pkg' },
      })
      render(
        <HeaderModals
          detail={detail}
          modalStates={modalStates}
          targetVersion={createTargetVersion()}
          isDowngrade={false}
          isAutoUpgradeEnabled={false}
          onUpdatedFromMarketplace={mockOnUpdatedFromMarketplace}
          onDelete={mockOnDelete}
        />,
      )

      expect(screen.getByTestId('plugin-info-repo')).toHaveTextContent('owner/repo')
    })

    it('should pass empty string for repo for non-GitHub source', () => {
      const modalStates = createModalStatesMock({ isShowPluginInfo: true })
      render(
        <HeaderModals
          detail={createPluginDetail({ source: PluginSource.marketplace })}
          modalStates={modalStates}
          targetVersion={createTargetVersion()}
          isDowngrade={false}
          isAutoUpgradeEnabled={false}
          onUpdatedFromMarketplace={mockOnUpdatedFromMarketplace}
          onDelete={mockOnDelete}
        />,
      )

      expect(screen.getByTestId('plugin-info-repo')).toHaveTextContent('')
    })

    it('should call hidePluginInfo when close button is clicked', () => {
      const modalStates = createModalStatesMock({ isShowPluginInfo: true })
      render(
        <HeaderModals
          detail={createPluginDetail()}
          modalStates={modalStates}
          targetVersion={createTargetVersion()}
          isDowngrade={false}
          isAutoUpgradeEnabled={false}
          onUpdatedFromMarketplace={mockOnUpdatedFromMarketplace}
          onDelete={mockOnDelete}
        />,
      )

      fireEvent.click(screen.getByTestId('plugin-info-close'))

      expect(modalStates.hidePluginInfo).toHaveBeenCalled()
    })
  })

  describe('Delete Confirm Modal', () => {
    it('should not render delete confirm when isShowDeleteConfirm is false', () => {
      const modalStates = createModalStatesMock({ isShowDeleteConfirm: false })
      render(
        <HeaderModals
          detail={createPluginDetail()}
          modalStates={modalStates}
          targetVersion={createTargetVersion()}
          isDowngrade={false}
          isAutoUpgradeEnabled={false}
          onUpdatedFromMarketplace={mockOnUpdatedFromMarketplace}
          onDelete={mockOnDelete}
        />,
      )

      expect(screen.queryByTestId('delete-confirm')).not.toBeInTheDocument()
    })

    it('should render delete confirm when isShowDeleteConfirm is true', () => {
      const modalStates = createModalStatesMock({ isShowDeleteConfirm: true })
      render(
        <HeaderModals
          detail={createPluginDetail()}
          modalStates={modalStates}
          targetVersion={createTargetVersion()}
          isDowngrade={false}
          isAutoUpgradeEnabled={false}
          onUpdatedFromMarketplace={mockOnUpdatedFromMarketplace}
          onDelete={mockOnDelete}
        />,
      )

      expect(screen.getByTestId('delete-confirm')).toBeInTheDocument()
    })

    it('should show correct delete title', () => {
      const modalStates = createModalStatesMock({ isShowDeleteConfirm: true })
      render(
        <HeaderModals
          detail={createPluginDetail()}
          modalStates={modalStates}
          targetVersion={createTargetVersion()}
          isDowngrade={false}
          isAutoUpgradeEnabled={false}
          onUpdatedFromMarketplace={mockOnUpdatedFromMarketplace}
          onDelete={mockOnDelete}
        />,
      )

      expect(screen.getByTestId('delete-title')).toHaveTextContent('plugin.action.delete')
    })

    it('should call hideDeleteConfirm when cancel is clicked', () => {
      const modalStates = createModalStatesMock({ isShowDeleteConfirm: true })
      render(
        <HeaderModals
          detail={createPluginDetail()}
          modalStates={modalStates}
          targetVersion={createTargetVersion()}
          isDowngrade={false}
          isAutoUpgradeEnabled={false}
          onUpdatedFromMarketplace={mockOnUpdatedFromMarketplace}
          onDelete={mockOnDelete}
        />,
      )

      fireEvent.click(screen.getByTestId('confirm-cancel'))

      expect(modalStates.hideDeleteConfirm).toHaveBeenCalled()
    })

    it('should call onDelete when confirm is clicked', () => {
      const modalStates = createModalStatesMock({ isShowDeleteConfirm: true })
      render(
        <HeaderModals
          detail={createPluginDetail()}
          modalStates={modalStates}
          targetVersion={createTargetVersion()}
          isDowngrade={false}
          isAutoUpgradeEnabled={false}
          onUpdatedFromMarketplace={mockOnUpdatedFromMarketplace}
          onDelete={mockOnDelete}
        />,
      )

      fireEvent.click(screen.getByTestId('confirm-ok'))

      expect(mockOnDelete).toHaveBeenCalled()
    })

    it('should disable confirm button when deleting', () => {
      const modalStates = createModalStatesMock({ isShowDeleteConfirm: true, deleting: true })
      render(
        <HeaderModals
          detail={createPluginDetail()}
          modalStates={modalStates}
          targetVersion={createTargetVersion()}
          isDowngrade={false}
          isAutoUpgradeEnabled={false}
          onUpdatedFromMarketplace={mockOnUpdatedFromMarketplace}
          onDelete={mockOnDelete}
        />,
      )

      expect(screen.getByTestId('confirm-ok')).toBeDisabled()
    })
  })

  describe('Update Modal', () => {
    it('should not render update modal when isShowUpdateModal is false', () => {
      const modalStates = createModalStatesMock({ isShowUpdateModal: false })
      render(
        <HeaderModals
          detail={createPluginDetail()}
          modalStates={modalStates}
          targetVersion={createTargetVersion()}
          isDowngrade={false}
          isAutoUpgradeEnabled={false}
          onUpdatedFromMarketplace={mockOnUpdatedFromMarketplace}
          onDelete={mockOnDelete}
        />,
      )

      expect(screen.queryByTestId('update-modal')).not.toBeInTheDocument()
    })

    it('should render update modal when isShowUpdateModal is true', () => {
      const modalStates = createModalStatesMock({ isShowUpdateModal: true })
      render(
        <HeaderModals
          detail={createPluginDetail()}
          modalStates={modalStates}
          targetVersion={createTargetVersion()}
          isDowngrade={false}
          isAutoUpgradeEnabled={false}
          onUpdatedFromMarketplace={mockOnUpdatedFromMarketplace}
          onDelete={mockOnDelete}
        />,
      )

      expect(screen.getByTestId('update-modal')).toBeInTheDocument()
    })

    it('should pass plugin id to update modal', () => {
      const modalStates = createModalStatesMock({ isShowUpdateModal: true })
      render(
        <HeaderModals
          detail={createPluginDetail({ plugin_id: 'my-plugin-id' })}
          modalStates={modalStates}
          targetVersion={createTargetVersion()}
          isDowngrade={false}
          isAutoUpgradeEnabled={false}
          onUpdatedFromMarketplace={mockOnUpdatedFromMarketplace}
          onDelete={mockOnDelete}
        />,
      )

      expect(screen.getByTestId('update-plugin-id')).toHaveTextContent('my-plugin-id')
    })

    it('should call onUpdatedFromMarketplace when save is clicked', () => {
      const modalStates = createModalStatesMock({ isShowUpdateModal: true })
      render(
        <HeaderModals
          detail={createPluginDetail()}
          modalStates={modalStates}
          targetVersion={createTargetVersion()}
          isDowngrade={false}
          isAutoUpgradeEnabled={false}
          onUpdatedFromMarketplace={mockOnUpdatedFromMarketplace}
          onDelete={mockOnDelete}
        />,
      )

      fireEvent.click(screen.getByTestId('update-modal-save'))

      expect(mockOnUpdatedFromMarketplace).toHaveBeenCalled()
    })

    it('should call hideUpdateModal when cancel is clicked', () => {
      const modalStates = createModalStatesMock({ isShowUpdateModal: true })
      render(
        <HeaderModals
          detail={createPluginDetail()}
          modalStates={modalStates}
          targetVersion={createTargetVersion()}
          isDowngrade={false}
          isAutoUpgradeEnabled={false}
          onUpdatedFromMarketplace={mockOnUpdatedFromMarketplace}
          onDelete={mockOnDelete}
        />,
      )

      fireEvent.click(screen.getByTestId('update-modal-cancel'))

      expect(modalStates.hideUpdateModal).toHaveBeenCalled()
    })

    it('should show downgrade warning when isDowngrade and isAutoUpgradeEnabled are true', () => {
      const modalStates = createModalStatesMock({ isShowUpdateModal: true })
      render(
        <HeaderModals
          detail={createPluginDetail()}
          modalStates={modalStates}
          targetVersion={createTargetVersion()}
          isDowngrade={true}
          isAutoUpgradeEnabled={true}
          onUpdatedFromMarketplace={mockOnUpdatedFromMarketplace}
          onDelete={mockOnDelete}
        />,
      )

      expect(screen.getByTestId('update-downgrade-warning')).toHaveTextContent('true')
    })

    it('should not show downgrade warning when only isDowngrade is true', () => {
      const modalStates = createModalStatesMock({ isShowUpdateModal: true })
      render(
        <HeaderModals
          detail={createPluginDetail()}
          modalStates={modalStates}
          targetVersion={createTargetVersion()}
          isDowngrade={true}
          isAutoUpgradeEnabled={false}
          onUpdatedFromMarketplace={mockOnUpdatedFromMarketplace}
          onDelete={mockOnDelete}
        />,
      )

      expect(screen.getByTestId('update-downgrade-warning')).toHaveTextContent('false')
    })

    it('should not show downgrade warning when only isAutoUpgradeEnabled is true', () => {
      const modalStates = createModalStatesMock({ isShowUpdateModal: true })
      render(
        <HeaderModals
          detail={createPluginDetail()}
          modalStates={modalStates}
          targetVersion={createTargetVersion()}
          isDowngrade={false}
          isAutoUpgradeEnabled={true}
          onUpdatedFromMarketplace={mockOnUpdatedFromMarketplace}
          onDelete={mockOnDelete}
        />,
      )

      expect(screen.getByTestId('update-downgrade-warning')).toHaveTextContent('false')
    })
  })

  describe('Multiple Modals', () => {
    it('should render multiple modals when multiple are open', () => {
      const modalStates = createModalStatesMock({
        isShowPluginInfo: true,
        isShowDeleteConfirm: true,
        isShowUpdateModal: true,
      })
      render(
        <HeaderModals
          detail={createPluginDetail()}
          modalStates={modalStates}
          targetVersion={createTargetVersion()}
          isDowngrade={false}
          isAutoUpgradeEnabled={false}
          onUpdatedFromMarketplace={mockOnUpdatedFromMarketplace}
          onDelete={mockOnDelete}
        />,
      )

      expect(screen.getByTestId('plugin-info')).toBeInTheDocument()
      expect(screen.getByTestId('delete-confirm')).toBeInTheDocument()
      expect(screen.getByTestId('update-modal')).toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should handle undefined target version values', () => {
      const modalStates = createModalStatesMock({ isShowUpdateModal: true })
      render(
        <HeaderModals
          detail={createPluginDetail()}
          modalStates={modalStates}
          targetVersion={{ version: undefined, unique_identifier: undefined }}
          isDowngrade={false}
          isAutoUpgradeEnabled={false}
          onUpdatedFromMarketplace={mockOnUpdatedFromMarketplace}
          onDelete={mockOnDelete}
        />,
      )

      expect(screen.getByTestId('update-modal')).toBeInTheDocument()
    })

    it('should handle empty meta for GitHub source', () => {
      const modalStates = createModalStatesMock({ isShowPluginInfo: true })
      const detail = createPluginDetail({
        source: PluginSource.github,
        meta: undefined,
      })
      render(
        <HeaderModals
          detail={detail}
          modalStates={modalStates}
          targetVersion={createTargetVersion()}
          isDowngrade={false}
          isAutoUpgradeEnabled={false}
          onUpdatedFromMarketplace={mockOnUpdatedFromMarketplace}
          onDelete={mockOnDelete}
        />,
      )

      expect(screen.getByTestId('plugin-info-repo')).toHaveTextContent('')
      expect(screen.getByTestId('plugin-info-package')).toHaveTextContent('')
    })
  })
})
