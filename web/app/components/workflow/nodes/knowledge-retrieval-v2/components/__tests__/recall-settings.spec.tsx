import type { ComponentProps } from 'react'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { consoleQuery } from '@/service/console'
import {
  createCatalogModelFixture,
  createDefaultModelFixture,
  createModelCatalogFixture,
  seedModelProviderQueries,
} from '@/test/console/model-provider'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import RecallSettings from '../recall-settings'

// The model selector has its own suite; this one only needs the selected value and a choice.
vi.mock('@/app/components/header/account-setting/model-provider-page/model-selector', () => ({
  ModelSelector: (props: {
    onValueChange: (value: { model: string; provider: string }) => void
    value?: { model: string; provider: string }
  }) => (
    <button
      type="button"
      onClick={() => props.onValueChange({ provider: 'custom/provider', model: 'custom-rerank' })}
    >
      reranker {props.value ? `${props.value.provider}/${props.value.model}` : 'none'}
    </button>
  ),
}))

function renderSettings(props: Partial<ComponentProps<typeof RecallSettings>> = {}) {
  const queryClient = createConsoleQueryClient()
  seedModelProviderQueries(queryClient, [
    createModelCatalogFixture({
      provider: 'system/provider',
      models: [createCatalogModelFixture({ model: 'system-rerank', model_type: 'rerank' })],
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
  return renderWithConsoleQuery(
    <RecallSettings
      topK={10}
      onModeChange={vi.fn()}
      onRerankingModelChange={vi.fn()}
      onScoreThresholdChange={vi.fn()}
      onTopKChange={vi.fn()}
      {...props}
    />,
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
    await user.click(screen.getByRole('button', { name: 'reranker system/provider/system-rerank' }))
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
    expect(onTopKChange).toHaveBeenLastCalledWith(100)
  })

  it('enables the score threshold at its default and edits its value', async () => {
    const user = userEvent.setup()
    const onScoreThresholdChange = vi.fn()
    renderSettings({ onScoreThresholdChange, scoreThreshold: null })

    await user.click(screen.getByRole('button', { name: 'dataset.retrievalSettings' }))
    await user.click(screen.getByRole('switch'))
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
    expect(
      screen.getByRole('button', { name: 'reranker custom/provider/custom-rerank' }),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'common.operation.reset' }))
    expect(onRerankingModelChange).toHaveBeenCalledWith(undefined)
  })
})
