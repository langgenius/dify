import type { MockInstance } from 'vite-plus/test'
import type { DatasetConfigs } from '@/models/debug'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { toast } from '@/app/components/app/configuration/toast'
import ConfigContext from '@/context/debug-configuration'
import { RerankingModeEnum } from '@/models/datasets'
import { seedModelProviderQueries } from '@/test/console/model-provider'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { createDebugConfigurationFixture } from '@/test/fixtures/debug-configuration'
import { createNuqsTestRenderer } from '@/test/nuqs-testing'
import { RETRIEVE_TYPE } from '@/types/app'
import ParamsConfig from '../index'

const render = createNuqsTestRenderer((ui: React.ReactElement) => {
  const queryClient = createConsoleQueryClient()
  seedModelProviderQueries(queryClient)
  return renderWithConsoleQuery(ui, { queryClient })
})

let toastErrorSpy: MockInstance

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

    const contextValue = createDebugConfigurationFixture({
      datasetConfigs: datasetConfigsState,
      setDatasetConfigs: (next: DatasetConfigs) => {
        setDatasetConfigsState(next)
      },
      rerankSettingModalOpen: modalOpen,
      setRerankSettingModalOpen: (open: boolean) => {
        setModalOpen(open)
      },
    })

    return <ConfigContext.Provider value={contextValue}>{children}</ConfigContext.Provider>
  }

  return render(
    <Wrapper>
      <ParamsConfig disabled={disabled} selectedDatasets={[]} />
    </Wrapper>,
  )
}

describe('dataset-config/params-config', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
    toastErrorSpy = vi.spyOn(toast, 'error').mockImplementation(() => '')
  })

  afterEach(() => {
    toastErrorSpy.mockRestore()
  })

  describe('Rendering', () => {
    it('should disable settings trigger when disabled is true', () => {
      renderParamsConfig({ disabled: true })

      expect(screen.getByRole('button', { name: 'dataset.retrievalSettings' }))!.toBeDisabled()
    })
  })

  describe('User Interactions', () => {
    it('should open modal and persist changes when save is clicked', async () => {
      renderParamsConfig()
      const user = userEvent.setup()

      await user.click(screen.getByRole('button', { name: 'dataset.retrievalSettings' }))
      const dialog = await screen.findByRole('dialog', {}, { timeout: 3000 })
      const dialogScope = within(dialog)

      const incrementButtons = dialogScope.getAllByRole('button', { name: /increment/i })
      await user.click(incrementButtons[0]!)

      await waitFor(() => {
        const [topKInput] = dialogScope.getAllByRole('textbox')
        expect(topKInput)!.toHaveValue('5')
      })

      await user.click(dialogScope.getByRole('button', { name: 'common.operation.save' }))

      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      })

      await user.click(screen.getByRole('button', { name: 'dataset.retrievalSettings' }))
      const reopenedDialog = await screen.findByRole('dialog', {}, { timeout: 3000 })
      const reopenedScope = within(reopenedDialog)
      const [reopenedTopKInput] = reopenedScope.getAllByRole('textbox')

      expect(reopenedTopKInput)!.toHaveValue('5')
    })

    it('should discard changes when cancel is clicked', async () => {
      renderParamsConfig()
      const user = userEvent.setup()

      await user.click(screen.getByRole('button', { name: 'dataset.retrievalSettings' }))
      const dialog = await screen.findByRole('dialog', {}, { timeout: 3000 })
      const dialogScope = within(dialog)

      const incrementButtons = dialogScope.getAllByRole('button', { name: /increment/i })
      await user.click(incrementButtons[0]!)

      await waitFor(() => {
        const [topKInput] = dialogScope.getAllByRole('textbox')
        expect(topKInput)!.toHaveValue('5')
      })

      const cancelButton = await dialogScope.findByRole('button', {
        name: 'common.operation.cancel',
      })
      await user.click(cancelButton)
      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      })

      // Re-open and verify the original value remains.
      await user.click(screen.getByRole('button', { name: 'dataset.retrievalSettings' }))
      const reopenedDialog = await screen.findByRole('dialog', {}, { timeout: 3000 })
      const reopenedScope = within(reopenedDialog)
      const [reopenedTopKInput] = reopenedScope.getAllByRole('textbox')

      expect(reopenedTopKInput)!.toHaveValue('4')
    })

    it('should prevent saving when rerank model is required but invalid', async () => {
      renderParamsConfig({
        datasetConfigs: createDatasetConfigs({
          reranking_enable: true,
          reranking_mode: RerankingModeEnum.RerankingModel,
        }),
        initialModalOpen: true,
      })
      const user = userEvent.setup()

      const dialog = await screen.findByRole('dialog', {}, { timeout: 3000 })
      const dialogScope = within(dialog)
      await user.click(dialogScope.getByRole('button', { name: 'common.operation.save' }))

      expect(toastErrorSpy).toHaveBeenCalledWith('appDebug.datasetConfig.rerankModelRequired')
      expect(screen.getByRole('dialog'))!.toBeInTheDocument()
    })
  })
})
