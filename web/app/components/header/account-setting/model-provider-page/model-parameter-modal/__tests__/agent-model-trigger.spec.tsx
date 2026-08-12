import type { MouseEvent } from 'react'
import type { ModelProvider } from '../../declarations'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { vi } from 'vitest'
import { PluginCategoryEnum } from '@/app/components/plugins/types'
import {
  CurrentSystemQuotaTypeEnum,
  CustomConfigurationStatusEnum,
  ModelTypeEnum,
  QuotaUnitEnum,
} from '../../declarations'
import AgentModelTrigger from '../agent-model-trigger'

let modelProviders: ModelProvider[] = []
let pluginInfo: { latest_package_identifier: string } | null = null
let pluginLoading = false
let inModelList = true
const invalidateInstalledPluginList = vi.fn()
const handleOpenModal = vi.fn()
const updateModelProviders = vi.fn()
const updateModelList = vi.fn()
const loadProviderDetail = vi.fn()
let isLoadingProviderDetail = false

vi.mock('@/context/provider-context', () => ({
  useProviderContext: () => ({
    modelProviders,
  }),
}))

vi.mock('@/service/use-plugins', () => ({
  useInvalidateInstalledPluginList: () => invalidateInstalledPluginList,
  useModelInList: () => ({ data: inModelList }),
  usePluginInfo: () => ({ data: pluginInfo, isLoading: pluginLoading }),
}))

vi.mock('../../hooks', () => ({
  useLazyModelProviderDetail: () => ({
    loadProviderDetail,
    isLoadingProviderDetail,
  }),
  useModelModalHandler: () => handleOpenModal,
  useUpdateModelList: () => updateModelList,
  useUpdateModelProviders: () => updateModelProviders,
}))

vi.mock('../../model-icon', () => ({
  default: () => <div>Icon</div>,
}))

vi.mock('../model-display', () => ({
  default: () => <div>ModelDisplay</div>,
}))

vi.mock('../status-indicators', () => ({
  default: () => <div>StatusIndicators</div>,
}))

vi.mock('@/app/components/workflow/nodes/_base/components/install-plugin-button', () => ({
  InstallPluginButton: ({
    onClick,
    onSuccess,
  }: {
    onClick: (event: MouseEvent<HTMLButtonElement>) => void
    onSuccess: () => void
  }) => (
    <button
      onClick={(event) => {
        onClick(event)
        onSuccess()
      }}
    >
      Install Plugin
    </button>
  ),
}))

describe('AgentModelTrigger', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    modelProviders = []
    pluginInfo = null
    pluginLoading = false
    inModelList = true
    isLoadingProviderDetail = false
  })

  it('should render loading state when plugin info is still fetching', () => {
    pluginLoading = true
    render(<AgentModelTrigger modelId="gpt-4" providerName="openai" />)
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('should render model actions for configured provider', () => {
    modelProviders = [
      {
        provider: 'openai',
        custom_configuration: { status: CustomConfigurationStatusEnum.noConfigure },
        system_configuration: {
          enabled: true,
          current_quota_type: CurrentSystemQuotaTypeEnum.paid,
          quota_configurations: [
            {
              quota_type: CurrentSystemQuotaTypeEnum.paid,
              quota_unit: QuotaUnitEnum.times,
              quota_limit: 10,
              quota_used: 1,
              last_used: 1,
              is_valid: true,
            },
          ],
        },
      },
    ] as unknown as ModelProvider[]
    render(<AgentModelTrigger modelId="gpt-4" providerName="openai" />)
    expect(screen.getByText('ModelDisplay')).toBeInTheDocument()
    expect(screen.getByText('StatusIndicators')).toBeInTheDocument()
  })

  it('should support plugin installation flow when provider is missing', () => {
    pluginInfo = { latest_package_identifier: 'plugin/demo@1.0.0' }
    render(
      <AgentModelTrigger
        modelId="gpt-4"
        providerName="openai"
        scope={`${ModelTypeEnum.textGeneration},${ModelTypeEnum.tts}`}
      />,
    )

    fireEvent.click(screen.getByText('Install Plugin'))
    expect(updateModelList).toHaveBeenCalledWith(ModelTypeEnum.textGeneration)
    expect(updateModelList).toHaveBeenCalledWith(ModelTypeEnum.tts)
    expect(updateModelProviders).toHaveBeenCalledTimes(1)
    expect(invalidateInstalledPluginList).toHaveBeenCalledWith(PluginCategoryEnum.model)
  })

  it('should not render the install action when the plugin has no package identifier', () => {
    pluginInfo = { latest_package_identifier: '' }

    render(<AgentModelTrigger modelId="gpt-4" providerName="openai" />)

    expect(screen.queryByText('Install Plugin')).not.toBeInTheDocument()
  })

  it('should show configuration action when provider requires setup', () => {
    modelProviders = [
      {
        provider: 'openai',
        custom_configuration: { status: CustomConfigurationStatusEnum.noConfigure },
        system_configuration: {
          enabled: false,
          current_quota_type: CurrentSystemQuotaTypeEnum.paid,
          quota_configurations: [],
        },
      },
    ] as unknown as ModelProvider[]

    render(<AgentModelTrigger modelId="gpt-4" providerName="openai" />)

    expect(screen.getByText('workflow.nodes.agent.notAuthorized')).toBeInTheDocument()
  })

  it('should load complete provider detail before opening configuration', async () => {
    const providerDetail = { provider: 'openai' } as ModelProvider
    modelProviders = [{ provider: 'openai', is_configured: false }] as unknown as ModelProvider[]
    loadProviderDetail.mockResolvedValue(providerDetail)

    render(<AgentModelTrigger modelId="gpt-4" providerName="openai" />)
    fireEvent.click(screen.getByRole('button', { name: /notAuthorized/ }))

    await waitFor(() => {
      expect(handleOpenModal).toHaveBeenCalledWith(providerDetail, 'predefined-model', undefined)
    })
  })

  it('should render unconfigured state when model is not selected', () => {
    render(<AgentModelTrigger />)
    expect(screen.getByText('workflow.nodes.agent.configureModel')).toBeInTheDocument()
  })
})
