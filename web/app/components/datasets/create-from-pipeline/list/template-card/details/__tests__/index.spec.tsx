import type { PipelineTemplateDetailResponse } from '@dify/contracts/api/console/rag/types.gen'
import { Dialog, DialogContent } from '@langgenius/dify-ui/dialog'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ChunkingMode } from '@/models/datasets'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import Details from '../index'

const getTemplate = vi.hoisted(() => vi.fn())
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'rag.pipeline.templates.byTemplateId.get': getTemplate,
    }),
  }
})
// Graph rendering has its own workflow suite; this dialog owns metadata and template actions.
vi.mock('@/app/components/workflow/workflow-preview', () => ({ default: () => null }))
const template: PipelineTemplateDetailResponse = {
  id: 'pipeline-1',
  name: 'Test Pipeline',
  description: 'Process documents',
  export_data: '',
  chunk_structure: ChunkingMode.text,
  icon_info: { icon_type: 'emoji', icon: '📊', icon_background: '#FFF4ED', icon_url: '' },
  graph: { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
}
const show = (onApplyTemplate = vi.fn()) =>
  render(
    <Dialog defaultOpen>
      <DialogContent>
        <Details
          id="pipeline-1"
          type="customized"
          name="Loading Pipeline"
          onApplyTemplate={onApplyTemplate}
        />
      </DialogContent>
    </Dialog>,
  )

it('keeps a pending template named and closable', async () => {
  const user = userEvent.setup()
  getTemplate.mockReturnValue(new Promise(() => {}))
  show()
  expect(screen.getByRole('dialog', { name: 'Loading Pipeline' })).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'common.operation.close' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
})

it.each([
  [ChunkingMode.text, 'General'],
  [ChunkingMode.parentChild, 'Parent-Child'],
  [ChunkingMode.qa, 'Q&A'],
])('loads %s template details before applying it', async (chunk_structure, structureLabel) => {
  const user = userEvent.setup()
  const pending = createDeferred<PipelineTemplateDetailResponse>()
  getTemplate.mockReturnValue(pending.promise)
  const apply = vi.fn()
  show(apply)
  await act(async () => pending.resolve({ ...template, chunk_structure }))
  expect(await screen.findByRole('dialog', { name: 'Test Pipeline' })).toBeInTheDocument()
  expect(screen.getByText(structureLabel)).toBeInTheDocument()
  expect(getTemplate).toHaveBeenCalledWith({
    params: { template_id: 'pipeline-1' },
    query: { type: 'customized' },
  })
  await user.click(screen.getByRole('button', { name: 'datasetPipeline.operations.useTemplate' }))
  expect(apply).toHaveBeenCalledOnce()
})
