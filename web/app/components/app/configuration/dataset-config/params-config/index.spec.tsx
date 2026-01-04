import type { MockedFunction, MockInstance } from 'vitest'
import type { DatasetConfigs } from '@/models/debug'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import Toast from '@/app/components/base/toast'
import {
  useCurrentProviderAndModel,
  useModelListAndDefaultModelAndCurrentProviderAndModel,
} from '@/app/components/header/account-setting/model-provider-page/hooks'
import ConfigContext from '@/context/debug-configuration'
import { RerankingModeEnum } from '@/models/datasets'
import { RETRIEVE_TYPE } from '@/types/app'
import ParamsConfig from './index'

vi.mock('@headlessui/react', () => ({
  Dialog: ({ children, className }: { children: React.ReactNode, className?: string }) => (
    <div role="dialog" className={className}>
      {children}
    </div>
  ),
  DialogPanel: ({ children, className, ...props }: { children: React.ReactNode, className?: string }) => (
    <div className={className} {...props}>
      {children}
    </div>
  ),
  DialogTitle: ({ children, className, ...props }: { children: React.ReactNode, className?: string }) => (
    <div className={className} {...props}>
      {children}
    </div>
  ),
  Transition: ({ show, children }: { show: boolean, children: React.ReactNode }) => (show ? <>{children}</> : null),
  TransitionChild: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Switch: ({ checked, onChange, children, ...props }: { checked: boolean, onChange?: (value: boolean) => void, children?: React.ReactNode }) => (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange?.(!checked)}
      {...props}
    >
      {children}
    </button>
  ),
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useModelListAndDefaultModelAndCurrentProviderAndModel: vi.fn(),
  useCurrentProviderAndModel: vi.fn(),
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/model-selector', () => {
  type Props = {
    defaultModel?: { provider: string, model: string }
    onSelect?: (model: { provider: string, model: string }) => void
  }

  const MockModelSelector = ({ defaultModel, onSelect }: Props) => (
    <button
      type="button"
      onClick={() => onSelect?.(defaultModel ?? { provider: 'mock-provider', model: 'mock-model' })}
    >
      Mock ModelSelector
    </button>
  )

  return {
    default: MockModelSelector,
  }
})

vi.mock('@/app/components/header/account-setting/model-provider-page/model-parameter-modal', () => ({
  default: () => <div data-testid="model-parameter-modal" />,
}))

const mockedUseModelListAndDefaultModelAndCurrentProviderAndModel = useModelListAndDefaultModelAndCurrentProviderAndModel as MockedFunction<typeof useModelListAndDefaultModelAndCurrentProviderAndModel>
const mockedUseCurrentProviderAndModel = useCurrentProviderAndModel as MockedFunction<typeof useCurrentProviderAndModel>
let toastNotifySpy: MockInstance

const createDatasetConfigs = (overrides: Partial<DatasetConfigs> = {}): DatasetConfigs => {
  return {
    retrieval_model: RETRIEVE_TYPE.multiWay,
    reranking_model: {
      reranking_provider_name: 'provider',
      reranking_model_name: 'rerank-model',
    },
    top_k: 4,
    score_threshold_enabled: false,
    score_threshold: 0,
    datasets: {
      datasets: [],
    },
    reranking_enable: false,
    reranking_mode: RerankingModeEnum.RerankingModel,
    ...overrides,
  }
}

const renderParamsConfig = ({
  datasetConfigs = createDatasetConfigs(),
  initialModalOpen = false,
  disabled,
}: {
  datasetConfigs?: DatasetConfigs
  initialModalOpen?: boolean
  disabled?: boolean
} = {}) => {
  const Wrapper = ({ children }: { children: React.ReactNode }) => {
    const [datasetConfigsState, setDatasetConfigsState] = React.useState(datasetConfigs)
    const [modalOpen, setModalOpen] = React.useState(initialModalOpen)

    const contextValue = {
      datasetConfigs: datasetConfigsState,
      setDatasetConfigs: (next: DatasetConfigs) => {
        setDatasetConfigsState(next)
      },
      rerankSettingModalOpen: modalOpen,
      setRerankSettingModalOpen: (open: boolean) => {
        setModalOpen(open)
      },
    } as unknown as React.ComponentProps<typeof ConfigContext.Provider>['value']

    return (
      <ConfigContext.Provider value={contextValue}>
        {children}
      </ConfigContext.Provider>
    )
  }

  return render(
    <ParamsConfig
      disabled={disabled}
      selectedDatasets={[]}
    />,
    { wrapper: Wrapper },
  )
}

describe('dataset-config/params-config', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
    toastNotifySpy = vi.spyOn(Toast, 'notify').mockImplementation(() => ({}))
    mockedUseModelListAndDefaultModelAndCurrentProviderAndModel.mockReturnValue({
      modelList: [],
      defaultModel: undefined,
      currentProvider: undefined,
      currentModel: undefined,
    })
    mockedUseCurrentProviderAndModel.mockReturnValue({
      currentProvider: undefined,
      currentModel: undefined,
    })
  })

  afterEach(() => {
    toastNotifySpy.mockRestore()
  })

  // Rendering tests (REQUIRED)
  describe('Rendering', () => {
    it('should disable settings trigger when disabled is true', () => {
      // Arrange
      renderParamsConfig({ disabled: true })

      // Assert
      expect(screen.getByRole('button', { name: 'dataset.retrievalSettings' })).toBeDisabled()
    })
  })

  // User Interactions
  describe('User Interactions', () => {
    it('should open modal and persist changes when save is clicked', async () => {
      // Arrange
      renderParamsConfig()
      const user = userEvent.setup()

      // Act
      await user.click(screen.getByRole('button', { name: 'dataset.retrievalSettings' }))
      const dialog = await screen.findByRole('dialog', {}, { timeout: 3000 })
      const dialogScope = within(dialog)

      const incrementButtons = dialogScope.getAllByRole('button', { name: 'increment' })
      await user.click(incrementButtons[0])

      await waitFor(() => {
        const [topKInput] = dialogScope.getAllByRole('spinbutton')
        expect(topKInput).toHaveValue(5)
      })

      await user.click(dialogScope.getByRole('button', { name: 'common.operation.save' }))

      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      })

      await user.click(screen.getByRole('button', { name: 'dataset.retrievalSettings' }))
      const reopenedDialog = await screen.findByRole('dialog', {}, { timeout: 3000 })
      const reopenedScope = within(reopenedDialog)
      const [reopenedTopKInput] = reopenedScope.getAllByRole('spinbutton')

      // Assert
      expect(reopenedTopKInput).toHaveValue(5)
    })

    it('should discard changes when cancel is clicked', async () => {
      // Arrange
      renderParamsConfig()
      const user = userEvent.setup()

      // Act
      await user.click(screen.getByRole('button', { name: 'dataset.retrievalSettings' }))
      const dialog = await screen.findByRole('dialog', {}, { timeout: 3000 })
      const dialogScope = within(dialog)

      const incrementButtons = dialogScope.getAllByRole('button', { name: 'increment' })
      await user.click(incrementButtons[0])

      await waitFor(() => {
        const [topKInput] = dialogScope.getAllByRole('spinbutton')
        expect(topKInput).toHaveValue(5)
      })

      const cancelButton = await dialogScope.findByRole('button', { name: 'common.operation.cancel' })
      await user.click(cancelButton)
      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      })

      // Re-open and verify the original value remains.
      await user.click(screen.getByRole('button', { name: 'dataset.retrievalSettings' }))
      const reopenedDialog = await screen.findByRole('dialog', {}, { timeout: 3000 })
      const reopenedScope = within(reopenedDialog)
      const [reopenedTopKInput] = reopenedScope.getAllByRole('spinbutton')

      // Assert
      expect(reopenedTopKInput).toHaveValue(4)
    })

    it('should prevent saving when rerank model is required but invalid', async () => {
      // Arrange
      renderParamsConfig({
        datasetConfigs: createDatasetConfigs({
          reranking_enable: true,
          reranking_mode: RerankingModeEnum.RerankingModel,
        }),
        initialModalOpen: true,
      })
      const user = userEvent.setup()

      // Act
      const dialog = await screen.findByRole('dialog', {}, { timeout: 3000 })
      const dialogScope = within(dialog)
      await user.click(dialogScope.getByRole('button', { name: 'common.operation.save' }))

      // Assert
      expect(toastNotifySpy).toHaveBeenCalledWith({
        type: 'error',
        message: 'appDebug.datasetConfig.rerankModelRequired',
      })
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })
  })
})
