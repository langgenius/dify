import type { DataSet } from '@/models/datasets'
import type { RetrievalConfig } from '@/types/app'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { IndexingType } from '@/app/components/datasets/create/step-two'
import { ChunkingMode, DatasetPermission, DataSourceType } from '@/models/datasets'
import { seedAccountProfileQuery } from '@/test/console/account-profile'
import { seedCurrentWorkspaceQuery } from '@/test/console/current-workspace'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { seedWorkspacePermissionsQuery } from '@/test/console/workspace-permissions'
import { createTestQueryClient } from '@/test/query-client'
import { RETRIEVE_METHOD } from '@/types/app'
import AddDataset from '../add-dataset'
import DatasetList from '../dataset-list'

const retrievalConfig: RetrievalConfig = {
  search_method: RETRIEVE_METHOD.fullText,
  reranking_enable: false,
  reranking_model: { reranking_provider_name: '', reranking_model_name: '' },
  top_k: 4,
  score_threshold_enabled: false,
  score_threshold: 0,
}

const datasets: DataSet[] = ['A', 'B'].map((name) => ({
  id: `dataset-${name}`,
  name: `Knowledge ${name}`,
  provider: 'internal',
  indexing_technique: IndexingType.ECONOMICAL,
  embedding_available: true,
  icon_info: { icon_type: 'emoji', icon: '📙', icon_background: '#FFF4ED', icon_url: '' },
  permission_keys: [],
  description: '',
  permission: DatasetPermission.allTeamMembers,
  indexing_status: 'completed',
  data_source_type: DataSourceType.FILE,
  created_by: 'user-1',
  updated_by: 'user-1',
  updated_at: 0,
  app_count: 0,
  doc_form: ChunkingMode.text,
  document_count: 1,
  total_document_count: 1,
  word_count: 100,
  embedding_model: '',
  embedding_model_provider: '',
  retrieval_model: retrievalConfig,
  retrieval_model_dict: retrievalConfig,
  tags: [],
  external_knowledge_info: {
    external_knowledge_id: '',
    external_knowledge_api_id: '',
    external_knowledge_api_name: '',
    external_knowledge_api_endpoint: '',
  },
  external_retrieval_model: { top_k: 4, score_threshold: 0, score_threshold_enabled: false },
  built_in_field_enabled: false,
  runtime_mode: 'general',
  enable_api: true,
  is_multimodal: false,
}))

function DatasetSelectionOwner({ onChange }: { onChange: (datasets: DataSet[]) => void }) {
  const [selected, setSelected] = useState<DataSet[]>([])
  const handleChange = (next: DataSet[]) => {
    setSelected(next)
    onChange(next)
  }
  return (
    <>
      <AddDataset selectedIds={selected.map((dataset) => dataset.id)} onChange={handleChange} />
      <DatasetList list={selected} onChange={handleChange} />
    </>
  )
}

it('reopens from the parent selection after a saved dataset is removed through the real list', async () => {
  const client = createTestQueryClient()
  seedAccountProfileQuery(client)
  seedCurrentWorkspaceQuery(client)
  seedWorkspacePermissionsQuery(client)
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (!url.includes('/datasets?')) throw new Error(`Unexpected request: ${url}`)
    return Response.json({ data: datasets, page: 1, limit: 20, total: 2, has_more: false })
  })
  const onChange = vi.fn()
  const user = userEvent.setup()
  const result = render(
    <QueryClientTestProvider queryClient={client}>
      <DatasetSelectionOwner onChange={onChange} />
    </QueryClientTestProvider>,
  )
  try {
    const entry = screen.getByRole('button', {
      name: 'common.operation.add workflow.nodes.knowledgeRetrieval.knowledge',
    })
    expect(fetchSpy).not.toHaveBeenCalled()
    await user.click(entry)
    const dialog = screen.getByRole('dialog', { name: 'appDebug.feature.dataSet.selectTitle' })
    await user.click(await within(dialog).findByRole('button', { name: /Knowledge A/ }))
    await user.click(within(dialog).getByRole('button', { name: /Knowledge B/ }))
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.add' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(onChange).toHaveBeenLastCalledWith(datasets)
    await user.click(screen.getAllByRole('button', { name: 'common.operation.remove' })[1]!)
    expect(onChange).toHaveBeenLastCalledWith([datasets[0]])
    expect(screen.queryByText('Knowledge B')).not.toBeInTheDocument()

    await user.click(entry)
    const reopened = screen.getByRole('dialog', { name: 'appDebug.feature.dataSet.selectTitle' })
    await within(reopened).findByRole('button', { name: /Knowledge B/ })
    expect(within(reopened).getByText('1 appDebug.feature.dataSet.selected')).toBeInTheDocument()
    await user.click(within(reopened).getByRole('button', { name: 'common.operation.add' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(onChange).toHaveBeenLastCalledWith([datasets[0]])
    expect(screen.queryByText('Knowledge B')).not.toBeInTheDocument()
  } finally {
    result.unmount()
    client.clear()
    fetchSpy.mockRestore()
  }
})
