import type { PipelineTemplateListResponse } from '@dify/contracts/api/console/rag/types.gen'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { ChunkingMode } from '@/models/datasets'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { apiError } from '@/test/fake-api'
import CustomizedList from '../customized-list'

const { getTemplates } = vi.hoisted(() => ({ getTemplates: vi.fn() }))
vi.mock('@/next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/app/components/workflow/plugin-dependency/hooks', () => ({
  usePluginDependencies: () => ({ handleCheckPluginDependencies: vi.fn() }),
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'rag.pipeline.templates.get': getTemplates,
    }),
  }
})

it('shows the customized section only once saved templates have loaded', async () => {
  const pending = createDeferred<PipelineTemplateListResponse>()
  getTemplates.mockReturnValue(pending.promise)
  render(<CustomizedList fallbackFocusRef={createRef<HTMLDivElement>()} />)
  expect(screen.queryByText('datasetPipeline.templates.customized')).not.toBeInTheDocument()
  await act(async () =>
    pending.resolve({
      pipeline_templates: [
        {
          id: 'template-1',
          name: 'Legal documents',
          description: 'Process legal documents',
          chunk_structure: ChunkingMode.text,
          position: 1,
          icon: { icon_type: 'emoji', icon: '📚', icon_background: '#FFF4ED' },
        },
      ],
    }),
  )
  expect(await screen.findByText('Legal documents')).toBeInTheDocument()
  expect(screen.getByText('datasetPipeline.templates.customized')).toBeInTheDocument()
  expect(
    screen.getByRole('button', { name: 'datasetPipeline.operations.choose' }),
  ).toBeInTheDocument()
  expect(getTemplates).toHaveBeenCalledWith({ query: { type: 'customized' } })
})

it('omits the customized section when there are no saved templates', async () => {
  getTemplates.mockResolvedValue({ pipeline_templates: [] })
  const { queryClient } = render(<CustomizedList fallbackFocusRef={createRef<HTMLDivElement>()} />)
  await waitFor(() => expect(queryClient.isFetching()).toBe(0))
  expect(screen.queryByText('datasetPipeline.templates.customized')).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'datasetPipeline.operations.choose' }),
  ).not.toBeInTheDocument()
})

it('shows a failed first load in the customized section with a retry', async () => {
  const user = userEvent.setup()
  getTemplates
    .mockRejectedValueOnce(apiError({ status: 503, message: 'Templates unavailable' }))
    .mockResolvedValue({ pipeline_templates: [] })
  render(<CustomizedList fallbackFocusRef={createRef<HTMLDivElement>()} />)

  expect(await screen.findByRole('alert')).toHaveTextContent('dataset.loadError')
  expect(screen.getByText('datasetPipeline.templates.customized')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  expect(getTemplates).toHaveBeenCalledTimes(2)
})
