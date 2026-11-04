import type { PipelineTemplateListResponse } from '@dify/contracts/api/console/rag/types.gen'
import { act, screen, waitFor } from '@testing-library/react'
import { ChunkingMode } from '@/models/datasets'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import BuiltInPipelineList from '../built-in-pipeline-list'

const { getTemplates } = vi.hoisted(() => ({ getTemplates: vi.fn() }))
let locale = 'en-US'
vi.mock('#i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#i18n')>()),
  useLocale: () => locale,
}))
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

beforeEach(() => {
  locale = 'en-US'
  getTemplates.mockResolvedValue({ pipeline_templates: [] })
})

it('shows built-in templates after loading without custom-template management actions', async () => {
  const pending = createDeferred<PipelineTemplateListResponse>()
  getTemplates.mockReturnValue(pending.promise)
  render(<BuiltInPipelineList />, { systemFeatures: { enable_marketplace: true } })
  expect(screen.queryByText('Legal documents')).not.toBeInTheDocument()
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
  expect(
    screen.getByRole('button', { name: 'datasetPipeline.operations.choose' }),
  ).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'common.operation.more' })).not.toBeInTheDocument()
})

it.each([
  ['zh-Hans', 'zh-Hans'],
  ['ja-JP', 'ja-JP'],
  ['fr-FR', 'en-US'],
])('requests %s templates using %s', async (requested, language) => {
  locale = requested
  render(<BuiltInPipelineList />, { systemFeatures: { enable_marketplace: true } })
  await waitFor(() =>
    expect(getTemplates).toHaveBeenCalledWith({ query: { type: 'built-in', language } }),
  )
})

it('does not request marketplace templates when the marketplace is disabled', () => {
  render(<BuiltInPipelineList />, { systemFeatures: { enable_marketplace: false } })
  expect(getTemplates).not.toHaveBeenCalled()
})
