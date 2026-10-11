import type { PipelineTemplate } from '@/models/pipeline'
import { Button } from '@langgenius/dify-ui/button'
import {
  QueryClient,
  QueryClientProvider,
  queryOptions,
  skipToken,
  useQuery,
} from '@tanstack/react-query'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { ChunkingMode } from '@/models/datasets'
import TemplateCard from '../index'

const templateQueryOptions = queryOptions({
  queryKey: ['pipeline-template'],
  queryFn: skipToken,
})

vi.mock('@/next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/app/components/base/amplitude', () => ({ trackEvent: vi.fn() }))
vi.mock('@/app/components/workflow/plugin-dependency/hooks', () => ({
  usePluginDependencies: () => ({ handleCheckPluginDependencies: vi.fn() }),
}))
vi.mock('@/service/knowledge/use-create-dataset', () => ({
  useCreatePipelineDatasetFromCustomized: () => ({ mutateAsync: vi.fn() }),
}))
vi.mock('@/service/knowledge/use-dataset', () => ({ useInvalidDatasetList: () => vi.fn() }))
vi.mock('@/service/use-pipeline', () => ({
  usePipelineTemplateById: () => useQuery(templateQueryOptions),
  useDeleteTemplate: () => ({ mutateAsync: vi.fn() }),
  useExportTemplateDSL: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useInvalidCustomizedTemplateList: () => vi.fn(),
}))

vi.mock('@/app/components/workflow/workflow-preview', () => ({
  default: () => <div>Workflow preview</div>,
}))
vi.mock('../edit-pipeline-info', () => ({ default: () => null }))

const pipeline: PipelineTemplate = {
  id: 'template-1',
  name: 'Document pipeline',
  description: 'Process documents',
  icon: { icon_type: 'emoji', icon: '📊', icon_background: '#FFF4ED', icon_url: '' },
  chunk_structure: ChunkingMode.text,
  position: 1,
}

const templateInfo = {
  name: 'Document pipeline',
  description: 'Process documents',
  icon_info: { icon_type: 'emoji', icon: '📊', icon_background: '#FFF4ED', icon_url: '' },
  chunk_structure: 'text',
  graph: { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
}

function TemplateCardFixture({ queryClient }: { queryClient: QueryClient }) {
  return (
    <QueryClientProvider client={queryClient}>
      <Button>Before template</Button>
      <div className="w-80">
        <TemplateCard pipeline={pipeline} type="built-in" showMoreOperations={false} />
      </div>
    </QueryClientProvider>
  )
}

describe('Template card focus', () => {
  it('reveals keyboard actions and restores visible focus after details closes away from the card', async () => {
    // Browser mode is required: display:none prevents native focus restoration,
    // and CSS hover/focus-within decides whether the returned button is visible.
    const queryClient = new QueryClient()
    queryClient.setQueryData(templateQueryOptions.queryKey, templateInfo)
    const screen = await render(<TemplateCardFixture queryClient={queryClient} />)
    await screen.getByRole('button', { name: 'Before template' }).click()
    await userEvent.tab()
    const choose = screen.getByRole('button', { name: 'datasetPipeline.operations.choose' })
    await expect.element(choose).toHaveFocus()
    expect(choose.element().checkVisibility({ checkOpacity: true })).toBe(true)
    await userEvent.tab()
    const details = screen.getByRole('button', { name: 'datasetPipeline.operations.details' })
    await expect.element(details).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    const dialog = screen.getByRole('dialog', { name: 'Document pipeline' })
    await expect.element(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'common.operation.close' }).click()
    await expect.element(dialog).not.toBeInTheDocument()
    await expect.element(details).toHaveFocus()
    expect(details.element().checkVisibility({ checkOpacity: true })).toBe(true)
    await userEvent.keyboard('{Enter}')
    await expect.element(dialog).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await expect.element(dialog).not.toBeInTheDocument()
    await expect.element(details).toHaveFocus()
    expect(details.element().checkVisibility({ checkOpacity: true })).toBe(true)
  })
})
