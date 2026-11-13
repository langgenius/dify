import type { ComponentProps } from 'react'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { consoleQuery } from '@/service/console'
import {
  createCatalogModelFixture,
  createDefaultModelFixture,
  createModelCatalogFixture,
  seedModelProviderQueries,
} from '@/test/console/model-provider'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { createNuqsTestWrapper } from '@/test/nuqs-testing'
import RecallSettings from '../recall-settings'

function renderSettings(props: Partial<ComponentProps<typeof RecallSettings>> = {}) {
  const queryClient = createConsoleQueryClient()
  seedModelProviderQueries(queryClient, [
    createModelCatalogFixture({
      provider: 'system/provider',
      models: [
        createCatalogModelFixture({
          model: 'system-rerank',
          label: { en_US: 'system-rerank' },
          model_type: 'rerank',
        }),
      ],
    }),
    createModelCatalogFixture({
      provider: 'custom/provider',
      models: [
        createCatalogModelFixture({
          model: 'custom-rerank',
          label: { en_US: 'custom-rerank' },
          model_type: 'rerank',
        }),
      ],
    }),
  ])
  queryClient.setQueryData(
    consoleQuery.workspaces.current.defaultModel.get.queryKey({
      input: { query: { model_type: 'rerank' } },
    }),
    {
      data: createDefaultModelFixture({
        model: 'system-rerank',
        model_type: 'rerank',
        provider: { provider: 'system/provider' },
      }),
    },
  )
  const { wrapper: UrlProvider } = createNuqsTestWrapper()
  function Settings() {
    const [rerankingModel, setRerankingModel] = useState(props.rerankingModel)
    const [topK, setTopK] = useState(10)
    const [scoreThreshold, setScoreThreshold] = useState(props.scoreThreshold)
    return (
      <RecallSettings
        onModeChange={vi.fn()}
        {...props}
        topK={topK}
        scoreThreshold={scoreThreshold}
        rerankingModel={rerankingModel}
        onRerankingModelChange={(value) => {
          setRerankingModel(value)
          props.onRerankingModelChange?.(value)
        }}
        onScoreThresholdChange={(value) => {
          setScoreThreshold(value)
          props.onScoreThresholdChange?.(value)
        }}
        onTopKChange={(value) => {
          setTopK(value)
          props.onTopKChange?.(value)
        }}
      />
    )
  }
  return renderWithConsoleQuery(
    <UrlProvider>
      <Settings />
    </UrlProvider>,
    { queryClient },
  )
}

describe('RecallSettings', () => {
  it('uses the workspace default reranker until the user selects an override', async () => {
    const user = userEvent.setup()
    const onRerankingModelChange = vi.fn()
    renderSettings({ onRerankingModelChange })

    await user.click(screen.getByRole('button', { name: 'dataset.retrievalSettings' }))
    expect(screen.getByText('modelProvider.modelProvider.defaultConfig')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /system-rerank/ }))
    await user.click(await screen.findByRole('button', { name: /custom-rerank/ }))
    expect(screen.getByRole('button', { name: /custom-rerank/ })).toBeInTheDocument()
    expect(onRerankingModelChange).toHaveBeenCalledWith({
      provider: 'custom/provider',
      model: 'custom-rerank',
    })
  })

  it('edits top K up to the knowledge retrieval maximum', async () => {
    const user = userEvent.setup()
    const onTopKChange = vi.fn()
    renderSettings({ onTopKChange })

    await user.click(screen.getByRole('button', { name: 'dataset.retrievalSettings' }))
    const slider = screen.getByLabelText('appDebug.datasetConfig.top_k', {
      selector: 'input[type="range"]',
    })
    slider.focus()
    await user.keyboard('{End}')
    expect(slider).toHaveValue('100')
    expect(onTopKChange).toHaveBeenLastCalledWith(100)
  })

  it('enables the score threshold at its default and edits its value', async () => {
    const user = userEvent.setup()
    const onScoreThresholdChange = vi.fn()
    renderSettings({ onScoreThresholdChange, scoreThreshold: null })

    await user.click(screen.getByRole('button', { name: 'dataset.retrievalSettings' }))
    await user.click(screen.getByRole('switch'))
    expect(screen.getByRole('switch')).toBeChecked()
    expect(onScoreThresholdChange).toHaveBeenLastCalledWith(0.5)
  })

  it('labels the retrieval-mode select with its visible heading', async () => {
    const user = userEvent.setup()
    renderSettings()

    await user.click(screen.getByRole('button', { name: 'dataset.retrievalSettings' }))
    const heading = screen.getByText('workflow.nodes.knowledgeRetrievalV2.mode.title')
    const select = screen.getByRole('combobox', {
      name: 'workflow.nodes.knowledgeRetrievalV2.mode.title',
    })
    await user.click(heading)
    expect(select).toHaveFocus()
  })

  it('can reset an explicit reranker back to the workspace default', async () => {
    const user = userEvent.setup()
    const onRerankingModelChange = vi.fn()
    renderSettings({
      onRerankingModelChange,
      rerankingModel: { provider: 'custom/provider', model: 'custom-rerank' },
    })

    await user.click(screen.getByRole('button', { name: 'dataset.retrievalSettings' }))
    expect(screen.getByRole('button', { name: /custom-rerank/ })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'common.operation.reset' }))
    expect(screen.getByRole('button', { name: /system-rerank/ })).toBeInTheDocument()
    expect(screen.getByText('modelProvider.modelProvider.defaultConfig')).toBeInTheDocument()
    expect(onRerankingModelChange).toHaveBeenCalledWith(undefined)
  })
})
