import type { AppPublisherMenuContentProps } from '../menu-content.types'
import type { AppDetailResponse } from '@/models/app'
import type { SystemFeatures } from '@/types/feature'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { toast } from '@/app/components/base/ui/toast'
import { AccessMode } from '@/models/access-control'
import { AppModeEnum } from '@/types/app'
import { defaultSystemFeatures } from '@/types/feature'
import MenuContent from '../menu-content'

vi.mock('@/app/components/base/ui/toast', () => ({
  toast: {
    error: vi.fn(),
  },
}))

vi.mock('@/app/components/billing/upgrade-btn', () => ({
  default: () => <div data-testid="upgrade-btn">upgrade-btn</div>,
}))

vi.mock('@/app/components/tools/workflow-tool/configure-button', () => ({
  default: () => <div data-testid="workflow-tool-configure-button">workflow-tool-configure-button</div>,
}))

const createSystemFeatures = (overrides: Partial<SystemFeatures> = {}): SystemFeatures => ({
  ...defaultSystemFeatures,
  ...overrides,
  branding: {
    ...defaultSystemFeatures.branding,
    ...overrides.branding,
  },
  license: {
    ...defaultSystemFeatures.license,
    ...overrides.license,
  },
  plugin_installation_permission: {
    ...defaultSystemFeatures.plugin_installation_permission,
    ...overrides.plugin_installation_permission,
  },
  webapp_auth: {
    ...defaultSystemFeatures.webapp_auth,
    ...overrides.webapp_auth,
    sso_config: {
      ...defaultSystemFeatures.webapp_auth.sso_config,
      ...overrides.webapp_auth?.sso_config,
    },
  },
})

const createAppDetail = (overrides: Partial<AppDetailResponse> = {}): AppDetailResponse => ({
  access_mode: AccessMode.PUBLIC,
  description: 'Workflow description',
  icon: '🤖',
  icon_background: '#ffffff',
  icon_type: 'emoji',
  id: 'app-1',
  mode: AppModeEnum.WORKFLOW,
  name: 'Workflow app',
  ...overrides,
} as AppDetailResponse)

const createProps = (overrides: Partial<AppPublisherMenuContentProps> = {}): AppPublisherMenuContentProps => ({
  appDetail: createAppDetail(),
  appURL: '/apps/app-1',
  debugWithMultipleModel: false,
  disabledFunctionButton: false,
  disabledFunctionTooltip: undefined,
  draftUpdatedAt: 5678,
  formatTimeFromNow: time => `from-now:${time}`,
  hasHumanInputNode: false,
  hasTriggerNode: false,
  inputs: [],
  isAppAccessSet: true,
  isChatApp: false,
  isGettingAppWhiteListSubjects: false,
  isGettingUserCanAccessApp: false,
  missingStartNode: false,
  multipleModelConfigs: [],
  onOpenEmbedding: vi.fn(),
  onOpenInExplore: vi.fn(),
  onPublish: vi.fn(),
  onPublishToMarketplace: vi.fn(),
  onRefreshData: vi.fn(),
  onRestore: vi.fn(),
  onShowAppAccessControl: vi.fn(),
  outputs: [],
  publishDisabled: false,
  published: false,
  publishedAt: 1234,
  publishingToMarketplace: false,
  publishLoading: false,
  startNodeLimitExceeded: false,
  systemFeatures: createSystemFeatures(),
  toolPublished: false,
  upgradeHighlightStyle: { backgroundImage: 'linear-gradient(90deg, red, blue)' },
  workflowToolDisabled: false,
  workflowToolMessage: undefined,
  ...overrides,
})

const renderMenuContent = (overrides: Partial<AppPublisherMenuContentProps> = {}) => {
  return render(<MenuContent {...createProps(overrides)} />)
}

describe('AppPublisherMenuContent', () => {
  it('should render published metadata and trigger restore for chat apps', async () => {
    const user = userEvent.setup()
    const onRestore = vi.fn()

    renderMenuContent({
      isChatApp: true,
      onRestore,
      publishedAt: 1234,
    })

    expect(screen.getByText('workflow.common.latestPublished')).toBeInTheDocument()
    expect(screen.getByText(/workflow\.common\.publishedAt/)).toBeInTheDocument()
    expect(screen.getByText(/from-now:1234/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'workflow.common.restore' }))

    expect(onRestore).toHaveBeenCalledTimes(1)
  })

  it('should render draft state, start node limit hint, and publish action for unpublished apps', async () => {
    const user = userEvent.setup()
    const onPublish = vi.fn()

    renderMenuContent({
      draftUpdatedAt: 5678,
      onPublish,
      publishedAt: undefined,
      startNodeLimitExceeded: true,
    })

    expect(screen.getByText('workflow.common.currentDraftUnpublished')).toBeInTheDocument()
    expect(screen.getByText(/workflow\.common\.autoSaved/)).toBeInTheDocument()
    expect(screen.getByText(/from-now:5678/)).toBeInTheDocument()
    expect(screen.getByText('workflow.publishLimit.startNodeTitlePrefix')).toBeInTheDocument()
    expect(screen.getByText('workflow.publishLimit.startNodeTitleSuffix')).toBeInTheDocument()
    expect(screen.getByText('workflow.publishLimit.startNodeDesc')).toBeInTheDocument()
    expect(screen.getByTestId('upgrade-btn')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /workflow\.common\.publishUpdate/i }))

    expect(onPublish).toHaveBeenCalledTimes(1)
  })

  it('should render access control status and open the access dialog when clicked', async () => {
    const user = userEvent.setup()
    const onShowAppAccessControl = vi.fn()

    renderMenuContent({
      appDetail: createAppDetail({ access_mode: AccessMode.SPECIFIC_GROUPS_MEMBERS }),
      isAppAccessSet: false,
      onShowAppAccessControl,
      systemFeatures: createSystemFeatures({
        webapp_auth: {
          ...defaultSystemFeatures.webapp_auth,
          enabled: true,
        },
      }),
    })

    expect(screen.getByText('app.publishApp.title')).toBeInTheDocument()
    expect(screen.getByText('app.accessControlDialog.accessItems.specific')).toBeInTheDocument()
    expect(screen.getByText('app.publishApp.notSet')).toBeInTheDocument()
    expect(screen.getByText('app.publishApp.notSetDesc')).toBeInTheDocument()

    await user.click(screen.getByText('app.publishApp.notSet'))

    expect(onShowAppAccessControl).toHaveBeenCalledTimes(1)
  })

  it('should render workflow actions and call the explore handler when requested', async () => {
    const user = userEvent.setup()
    const onOpenInExplore = vi.fn()

    renderMenuContent({
      onOpenInExplore,
      publishedAt: 1234,
    })

    expect(screen.getByText('workflow.common.runApp')).toBeInTheDocument()
    expect(screen.getByText('workflow.common.batchRunApp')).toBeInTheDocument()
    expect(screen.getByText('workflow.common.openInExplore')).toBeInTheDocument()
    expect(screen.getByText('workflow.common.accessAPIReference')).toBeInTheDocument()
    expect(screen.getByTestId('workflow-tool-configure-button')).toBeInTheDocument()

    expect(screen.getByText('workflow.common.runApp').closest('a')).toHaveAttribute('href', '/apps/app-1')
    expect(screen.getByText('workflow.common.batchRunApp').closest('a')).toHaveAttribute('href', '/apps/app-1?mode=batch')

    await user.click(screen.getByText('workflow.common.openInExplore'))

    expect(onOpenInExplore).toHaveBeenCalledTimes(1)
  })

  it('should disable unavailable actions and surface marketplace publishing state', () => {
    renderMenuContent({
      disabledFunctionButton: true,
      disabledFunctionTooltip: 'permission denied',
      missingStartNode: true,
      publishingToMarketplace: true,
      systemFeatures: createSystemFeatures({
        enable_creators_platform: true,
      }),
    })

    expect(screen.getByText('workflow.common.runApp').closest('a')).not.toHaveAttribute('href')
    expect(screen.getByText('workflow.common.batchRunApp').closest('a')).not.toHaveAttribute('href')
    expect(screen.getByText('workflow.common.openInExplore').closest('a')).not.toHaveAttribute('href')
    expect(screen.getByText('workflow.common.accessAPIReference').closest('a')).not.toHaveAttribute('href')

    expect(screen.getByText('workflow.common.publishingToMarketplace')).toBeInTheDocument()
  })

  it('should hide suggested actions when the workflow already has a trigger node', () => {
    renderMenuContent({
      hasTriggerNode: true,
    })

    expect(screen.queryByText('workflow.common.runApp')).not.toBeInTheDocument()
    expect(screen.queryByTestId('workflow-tool-configure-button')).not.toBeInTheDocument()
  })

  it('should not attempt to open explore when the action is disabled', async () => {
    const user = userEvent.setup()
    const onOpenInExplore = vi.fn()

    renderMenuContent({
      disabledFunctionButton: true,
      disabledFunctionTooltip: 'permission denied',
      onOpenInExplore,
      publishedAt: undefined,
    })

    await user.click(screen.getByText('workflow.common.openInExplore'))

    expect(onOpenInExplore).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
  })
})
