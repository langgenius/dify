import type { ComponentProps } from 'react'
import type { ConfigurationViewModel } from '../hooks/configuration-view-model'
import type AppPublisher from '@/app/components/app/app-publisher/features-wrapper'
import type { InstallBundleCompleteCallback } from '@/app/components/plugins/install-plugin/install-bundle'
import type { Plugin } from '@/app/components/plugins/types'
import type { AgentTool } from '@/types/app'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { PluginCategoryEnum } from '@/app/components/plugins/types'
import { CollectionType } from '@/app/components/tools/types'
import { createDebugConfigurationFixture } from '@/test/fixtures/debug-configuration'
import ConfigurationView from '../configuration-view'

const mockIsAgentV2Enabled = vi.hoisted(() => vi.fn(() => false))

vi.mock('@/features/agent-v2/feature-flag', () => ({
  isAgentV2Enabled: () => mockIsAgentV2Enabled(),
}))

vi.mock('@/app/components/app/app-publisher/features-wrapper', () => ({
  default: () => <div data-testid="app-publisher" />,
}))

vi.mock('@/app/components/app/configuration/config', () => ({
  default: () => <div data-testid="config-panel" />,
}))

vi.mock('@/app/components/app/configuration/debug', () => ({
  default: () => <div data-testid="debug-panel" />,
}))

vi.mock(
  '@/app/components/header/account-setting/model-provider-page/model-parameter-modal',
  () => ({
    default: () => <div data-testid="model-parameter-modal" />,
  }),
)

vi.mock('@/app/components/app/configuration/dataset-config/select-dataset', () => ({
  default: () => <div data-testid="select-dataset" />,
}))

vi.mock('@/app/components/app/configuration/config-prompt/conversation-history/edit-modal', () => ({
  default: () => <div data-testid="history-modal" />,
}))

vi.mock('@/app/components/base/features/new-feature-panel', () => ({
  default: () => <div data-testid="feature-panel" />,
}))

let pluginDependencyOnInstallComplete: InstallBundleCompleteCallback | undefined
vi.mock('@/app/components/workflow/plugin-dependency', () => ({
  default: ({ onInstallComplete }: { onInstallComplete?: InstallBundleCompleteCallback }) => {
    pluginDependencyOnInstallComplete = onInstallComplete
    return <div data-testid="plugin-dependency" />
  },
}))

const createPlugin = (name: string): Plugin => ({
  type: 'plugin',
  org: 'vendor',
  name,
  plugin_id: 'vendor',
  version: '1.0.0',
  latest_version: '1.0.0',
  latest_package_identifier: `vendor/${name}:1.0.0`,
  icon: 'icon.svg',
  verified: true,
  label: { 'en-US': name },
  brief: { 'en-US': name },
  description: { 'en-US': name },
  introduction: '',
  repository: `https://example.com/vendor/${name}`,
  category: PluginCategoryEnum.tool,
  install_count: 0,
  endpoint: { settings: [] },
  tags: [],
  badges: [],
  verification: { authorized_category: 'community' },
  from: 'marketplace',
})

const createDeletedAgentTool = (providerId: string): AgentTool => ({
  provider_id: providerId,
  provider_type: CollectionType.builtIn,
  provider_name: providerId,
  tool_name: 'search',
  tool_label: 'Search',
  tool_parameters: {},
  enabled: true,
  isDeleted: true,
})

const createContextValue = () =>
  createDebugConfigurationFixture({ appId: 'app-1', setModelConfig: vi.fn() })

const createViewModel = (
  overrides: Partial<ConfigurationViewModel> = {},
): ConfigurationViewModel => ({
  appPublisherProps: {
    appId: 'app-1',
    publishDisabled: false,
    publishedAt: 0,
    debugWithMultipleModel: false,
    multipleModelConfigs: [],
    onPublish: vi.fn(),
    publishedConfig: {
      modelConfig: createContextValue().modelConfig,
      completionParams: {},
      promptMode: createContextValue().promptMode,
      chatPromptConfig: createContextValue().chatPromptConfig,
      completionPromptConfig: createContextValue().completionPromptConfig,
      datasetConfigs: createContextValue().datasetConfigs,
      externalDataToolsConfig: createContextValue().externalDataToolsConfig,
    },
    resetAppConfig: vi.fn(),
  } as ComponentProps<typeof AppPublisher>,
  contextValue: createContextValue(),
  featuresData: {
    moreLikeThis: { enabled: false },
    opening: { enabled: false, opening_statement: '', suggested_questions: [] },
    moderation: { enabled: false },
    speech2text: { enabled: false },
    text2speech: { enabled: false, voice: '', language: '' },
    file: {
      enabled: false,
      image: { enabled: false, detail: 'high', number_limits: 3, transfer_methods: ['local_file'] },
    } as never,
    suggested: { enabled: false },
    citation: { enabled: false },
    annotationReply: { enabled: false },
  },
  isAgent: false,
  isAdvancedMode: false,
  isMobile: false,
  isShowDebugPanel: false,
  isShowHistoryModal: false,
  isShowSelectDataSet: false,
  modelConfig: createContextValue().modelConfig,
  multipleModelConfigs: [],
  onAutoAddPromptVariable: vi.fn(),
  onAgentSettingChange: vi.fn(),
  onCloseFeaturePanel: vi.fn(),
  onCloseHistoryModal: vi.fn(),
  onCloseSelectDataSet: vi.fn(),
  onCompletionParamsChange: vi.fn(),
  onConfirmUseGPT4: vi.fn(),
  onEnableMultipleModelDebug: vi.fn(),
  onFeaturesChange: vi.fn(),
  onHideDebugPanel: vi.fn(),
  onModelChange: vi.fn(),
  onMultipleModelConfigsChange: vi.fn(),
  onOpenAccountSettings: vi.fn(),
  onOpenDebugPanel: vi.fn(),
  onSaveHistory: vi.fn(),
  onSelectDataSets: vi.fn(),
  promptVariables: [],
  selectedIds: [],
  showAppConfigureFeaturesModal: false,
  showLoading: false,
  showUseGPT4Confirm: false,
  setShowUseGPT4Confirm: vi.fn(),
  ...overrides,
})

describe('ConfigurationView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsAgentV2Enabled.mockReturnValue(false)
    pluginDependencyOnInstallComplete = undefined
  })

  it('should render a loading state before configuration data is ready', () => {
    render(<ConfigurationView {...createViewModel({ showLoading: true })} />)

    expect(screen.getByRole('progressbar', { name: 'common.loading' })).toBeInTheDocument()
    expect(screen.queryByTestId('app-publisher')).not.toBeInTheDocument()
  })

  it('provides the page heading inside the parent-owned main landmark', () => {
    render(<ConfigurationView {...createViewModel()} />)
    expect(
      screen.getByRole('heading', { level: 1, name: 'appDebug.orchestrate' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('main')).not.toBeInTheDocument()
  })

  it('should open the mobile debug panel from the header button', async () => {
    const user = userEvent.setup()
    const onOpenDebugPanel = vi.fn()
    render(<ConfigurationView {...createViewModel({ isMobile: true, onOpenDebugPanel })} />)

    await user.click(screen.getByRole('button', { name: /appDebug.operation.debugConfig/i }))

    expect(onOpenDebugPanel).toHaveBeenCalledTimes(1)
  })

  it('should close the GPT-4 confirmation dialog when cancel is clicked', async () => {
    const user = userEvent.setup()
    const setShowUseGPT4Confirm = vi.fn()
    render(
      <ConfigurationView
        {...createViewModel({ showUseGPT4Confirm: true, setShowUseGPT4Confirm })}
      />,
    )

    await user.click(screen.getByRole('button', { name: /operation.cancel/i }))

    expect(setShowUseGPT4Confirm).toHaveBeenCalledWith(false)
  })

  it('should show the legacy Agent badge for legacy Agent apps when Agent v2 is enabled', async () => {
    const user = userEvent.setup()
    mockIsAgentV2Enabled.mockReturnValue(true)
    const contextValue = createContextValue()
    contextValue.mode = 'agent-chat'

    render(<ConfigurationView {...createViewModel({ contextValue })} />)

    const badge = screen.getByRole('button', { name: 'appDebug.legacyAgentBadge.label' })

    await user.click(badge)

    expect(await screen.findByText('appDebug.legacyAgentBadge.description')).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: /appDebug\.legacyAgentBadge\.action/ }),
    ).toHaveAttribute('href', '/agents')
    expect(
      screen.getByRole('link', { name: /appDebug\.legacyAgentBadge\.action/ }),
    ).toHaveAttribute('target', '_blank')
    expect(
      screen.getByRole('link', { name: /appDebug\.legacyAgentBadge\.action/ }),
    ).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('should not show the legacy Agent badge when Agent v2 is disabled', () => {
    const contextValue = createContextValue()
    contextValue.mode = 'agent-chat'

    render(<ConfigurationView {...createViewModel({ contextValue })} />)

    expect(screen.queryByText('appDebug.legacyAgentBadge.label')).not.toBeInTheDocument()
  })

  it('should reinstate selected plugin tools when at least one installation succeeds', () => {
    const contextValue = createContextValue()
    contextValue.isAgent = true
    const tools = [
      createDeletedAgentTool('vendor/successful-plugin'),
      createDeletedAgentTool('vendor/failed-plugin'),
      createDeletedAgentTool('vendor/unselected-plugin'),
    ]
    contextValue.modelConfig.agentConfig.tools = tools

    render(<ConfigurationView {...createViewModel({ contextValue, isAgent: true })} />)
    if (!pluginDependencyOnInstallComplete)
      throw new Error('Plugin completion callback not registered')

    pluginDependencyOnInstallComplete(
      [createPlugin('successful-plugin'), createPlugin('failed-plugin')],
      [
        { success: true, isFromMarketPlace: true },
        { success: false, isFromMarketPlace: true },
      ],
      [
        { hasInstalled: false, toInstallVersion: '1.0.0' },
        { hasInstalled: false, toInstallVersion: '1.0.0' },
      ],
    )

    expect(contextValue.setModelConfig).toHaveBeenCalledOnce()
    const nextModelConfig = vi.mocked(contextValue.setModelConfig).mock.calls[0]![0]
    expect(nextModelConfig.agentConfig.tools).toEqual([
      expect.objectContaining({ provider_id: 'vendor/successful-plugin', isDeleted: false }),
      expect.objectContaining({ provider_id: 'vendor/failed-plugin', isDeleted: false }),
      expect.objectContaining({ provider_id: 'vendor/unselected-plugin', isDeleted: true }),
    ])
  })

  it('should keep deleted tools unchanged when every installation fails', () => {
    const contextValue = createContextValue()
    contextValue.isAgent = true
    contextValue.modelConfig.agentConfig.tools = [createDeletedAgentTool('vendor/failed-plugin')]

    render(<ConfigurationView {...createViewModel({ contextValue, isAgent: true })} />)
    if (!pluginDependencyOnInstallComplete)
      throw new Error('Plugin completion callback not registered')

    pluginDependencyOnInstallComplete(
      [createPlugin('failed-plugin')],
      [{ success: false, isFromMarketPlace: true }],
      [{ hasInstalled: false, toInstallVersion: '1.0.0' }],
    )

    expect(contextValue.setModelConfig).not.toHaveBeenCalled()
  })

  it('should not attach the agent tool completion handler to non-agent configurations', () => {
    render(<ConfigurationView {...createViewModel()} />)

    expect(pluginDependencyOnInstallComplete).toBeUndefined()
  })
})
