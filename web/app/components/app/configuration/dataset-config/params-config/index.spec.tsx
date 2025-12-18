import * as React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ParamsConfig from './index'
import ConfigContext from '@/context/debug-configuration'
import type { DatasetConfigs } from '@/models/debug'
import { RerankingModeEnum } from '@/models/datasets'
import { RETRIEVE_TYPE } from '@/types/app'
import Toast from '@/app/components/base/toast'
import {
  useCurrentProviderAndModel,
  useModelListAndDefaultModelAndCurrentProviderAndModel,
} from '@/app/components/header/account-setting/model-provider-page/hooks'

jest.mock('@/app/components/base/modal', () => {
  type Props = {
    isShow: boolean
    children?: React.ReactNode
  }

  const MockModal = ({ isShow, children }: Props) => {
    if (!isShow) return null
    return <div role="dialog">{children}</div>
  }

  return {
    __esModule: true,
    default: MockModal,
  }
})

jest.mock('@/app/components/base/toast', () => ({
  __esModule: true,
  default: {
    notify: jest.fn(),
  },
}))

jest.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useModelListAndDefaultModelAndCurrentProviderAndModel: jest.fn(),
  useCurrentProviderAndModel: jest.fn(),
}))

jest.mock('@/app/components/header/account-setting/model-provider-page/model-selector', () => {
  type Props = {
    defaultModel?: { provider: string; model: string }
    onSelect?: (model: { provider: string; model: string }) => void
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
    __esModule: true,
    default: MockModelSelector,
  }
})

jest.mock('@/app/components/header/account-setting/model-provider-page/model-parameter-modal', () => ({
  __esModule: true,
  default: () => <div data-testid="model-parameter-modal" />,
}))

const mockedUseModelListAndDefaultModelAndCurrentProviderAndModel = useModelListAndDefaultModelAndCurrentProviderAndModel as jest.MockedFunction<typeof useModelListAndDefaultModelAndCurrentProviderAndModel>
const mockedUseCurrentProviderAndModel = useCurrentProviderAndModel as jest.MockedFunction<typeof useCurrentProviderAndModel>
const mockToastNotify = Toast.notify as unknown as jest.Mock

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
  const setDatasetConfigsSpy = jest.fn<void, [DatasetConfigs]>()
  const setModalOpenSpy = jest.fn<void, [boolean]>()

  const Wrapper = ({ children }: { children: React.ReactNode }) => {
    const [datasetConfigsState, setDatasetConfigsState] = React.useState(datasetConfigs)
    const [modalOpen, setModalOpen] = React.useState(initialModalOpen)

    const contextValue = {
      datasetConfigs: datasetConfigsState,
      setDatasetConfigs: (next: DatasetConfigs) => {
        setDatasetConfigsSpy(next)
        setDatasetConfigsState(next)
      },
      rerankSettingModalOpen: modalOpen,
      setRerankSettingModalOpen: (open: boolean) => {
        setModalOpenSpy(open)
        setModalOpen(open)
      },
    } as unknown as React.ComponentProps<typeof ConfigContext.Provider>['value']

    return (
      <ConfigContext.Provider value={contextValue}>
        {children}
      </ConfigContext.Provider>
    )
  }

  render(
    <ParamsConfig
      disabled={disabled}
      selectedDatasets={[]}
    />,
    { wrapper: Wrapper },
  )

  return {
    setDatasetConfigsSpy,
    setModalOpenSpy,
  }
}

describe('dataset-config/params-config', () => {
  beforeEach(() => {
    jest.clearAllMocks()
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
      const user = userEvent.setup()
      const { setDatasetConfigsSpy } = renderParamsConfig()

      // Act
      await user.click(screen.getByRole('button', { name: 'dataset.retrievalSettings' }))
      await screen.findByRole('dialog')

      // Change top_k via the first number input increment control.
      const incrementButtons = screen.getAllByRole('button', { name: 'increment' })
      await user.click(incrementButtons[0])

      await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

      // Assert
      expect(setDatasetConfigsSpy).toHaveBeenCalledWith(expect.objectContaining({ top_k: 5 }))
      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      })
    })

    it('should discard changes when cancel is clicked', async () => {
      // Arrange
      const user = userEvent.setup()
      const { setDatasetConfigsSpy } = renderParamsConfig()

      // Act
      await user.click(screen.getByRole('button', { name: 'dataset.retrievalSettings' }))
      await screen.findByRole('dialog')

      const incrementButtons = screen.getAllByRole('button', { name: 'increment' })
      await user.click(incrementButtons[0])

      await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      })

      // Re-open and save without changes.
      await user.click(screen.getByRole('button', { name: 'dataset.retrievalSettings' }))
      await screen.findByRole('dialog')
      await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

      // Assert - should save original top_k rather than the canceled change.
      expect(setDatasetConfigsSpy).toHaveBeenCalledWith(expect.objectContaining({ top_k: 4 }))
    })

    it('should prevent saving when rerank model is required but invalid', async () => {
      // Arrange
      const user = userEvent.setup()
      const { setDatasetConfigsSpy } = renderParamsConfig({
        datasetConfigs: createDatasetConfigs({
          reranking_enable: true,
          reranking_mode: RerankingModeEnum.RerankingModel,
        }),
        initialModalOpen: true,
      })

      // Act
      await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

      // Assert
      expect(mockToastNotify).toHaveBeenCalledWith({
        type: 'error',
        message: 'appDebug.datasetConfig.rerankModelRequired',
      })
      expect(setDatasetConfigsSpy).not.toHaveBeenCalled()
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })
  })
})
