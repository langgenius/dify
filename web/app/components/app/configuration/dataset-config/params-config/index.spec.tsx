import * as React from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
let toastNotifySpy: jest.SpyInstance

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
    jest.useRealTimers()
    toastNotifySpy = jest.spyOn(Toast, 'notify').mockImplementation(() => ({}))
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
      const { setDatasetConfigsSpy } = renderParamsConfig()

      // Act
      fireEvent.click(screen.getByRole('button', { name: 'dataset.retrievalSettings' }))
      const dialog = await screen.findByRole('dialog', {}, { timeout: 3000 })
      const dialogScope = within(dialog)

      // Change top_k via the first number input increment control.
      const incrementButtons = dialogScope.getAllByRole('button', { name: 'increment' })
      fireEvent.click(incrementButtons[0])

      const saveButton = await dialogScope.findByRole('button', { name: 'common.operation.save' })
      fireEvent.click(saveButton)

      // Assert
      expect(setDatasetConfigsSpy).toHaveBeenCalledWith(expect.objectContaining({ top_k: 5 }))
      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      })
    })

    it('should discard changes when cancel is clicked', async () => {
      // Arrange
      const { setDatasetConfigsSpy } = renderParamsConfig()

      // Act
      fireEvent.click(screen.getByRole('button', { name: 'dataset.retrievalSettings' }))
      const dialog = await screen.findByRole('dialog', {}, { timeout: 3000 })
      const dialogScope = within(dialog)

      const incrementButtons = dialogScope.getAllByRole('button', { name: 'increment' })
      fireEvent.click(incrementButtons[0])

      const cancelButton = await dialogScope.findByRole('button', { name: 'common.operation.cancel' })
      fireEvent.click(cancelButton)
      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      })

      // Re-open and save without changes.
      fireEvent.click(screen.getByRole('button', { name: 'dataset.retrievalSettings' }))
      const reopenedDialog = await screen.findByRole('dialog', {}, { timeout: 3000 })
      const reopenedScope = within(reopenedDialog)
      const reopenedSave = await reopenedScope.findByRole('button', { name: 'common.operation.save' })
      fireEvent.click(reopenedSave)

      // Assert - should save original top_k rather than the canceled change.
      expect(setDatasetConfigsSpy).toHaveBeenCalledWith(expect.objectContaining({ top_k: 4 }))
    })

    it('should prevent saving when rerank model is required but invalid', async () => {
      // Arrange
      const { setDatasetConfigsSpy } = renderParamsConfig({
        datasetConfigs: createDatasetConfigs({
          reranking_enable: true,
          reranking_mode: RerankingModeEnum.RerankingModel,
        }),
        initialModalOpen: true,
      })

      // Act
      const dialog = await screen.findByRole('dialog', {}, { timeout: 3000 })
      const dialogScope = within(dialog)
      fireEvent.click(dialogScope.getByRole('button', { name: 'common.operation.save' }))

      // Assert
      expect(toastNotifySpy).toHaveBeenCalledWith({
        type: 'error',
        message: 'appDebug.datasetConfig.rerankModelRequired',
      })
      expect(setDatasetConfigsSpy).not.toHaveBeenCalled()
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })
  })
})
