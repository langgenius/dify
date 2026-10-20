import type { CloudPlan } from '@dify/contracts/api/console/features/types.gen'
import { act, cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { createNode } from '@/app/components/workflow/__tests__/fixtures'
import datasourceDefault from '@/app/components/workflow/nodes/data-source/default'
import { BlockEnum } from '@/app/components/workflow/types'
import DatasetDetailContext from '@/context/dataset-detail'
import { DatasourceType } from '@/models/pipeline'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { createDatasetFixture } from '@/test/fixtures/dataset'
import { createFileUploadConfigFixture } from '@/test/fixtures/file-upload-config'
import { createWorkflowResponseFixture } from '@/test/fixtures/workflow-response'
import { DatasetACLPermission } from '@/utils/permission'
import CreateFromPipeline from '../index'

const api = vi.hoisted(() => ({
  upload: vi.fn<typeof import('@/service/base').upload>(),
  capacity: vi.fn<typeof import('@/service/console').consoleClient.features.vectorSpace.get>(),
  replace: vi.fn(),
}))
vi.mock('@/service/base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/base')>()),
  upload: api.upload,
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'features.vectorSpace.get': api.capacity,
      'rag.pipelines.datasourcePlugins.get': async () => [],
      'rag.pipelines.byPipelineId.workflows.published.processing.parameters.get': async () => ({
        variables: [],
      }),
    }),
  }
})
vi.mock('@/next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/next/navigation')>()),
  useParams: () => ({ datasetId: 'dataset-1' }),
  useRouter: () => ({ push: vi.fn(), replace: api.replace, back: vi.fn() }),
  usePathname: () => '/datasets/dataset-1/documents/create-from-pipeline',
}))

beforeEach(() => {
  api.replace.mockReset()
  api.upload.mockReset().mockResolvedValue({
    id: 'file-1',
    name: 'Guide.pdf',
    size: 8,
    extension: 'pdf',
    mime_type: 'application/pdf',
    created_by: 'user-1',
    created_at: 1700000000,
  })
  api.capacity.mockReset().mockResolvedValue({ size: 0, limit: 50, usage_unknown: false })
})
afterEach(async () => {
  await act(async () => cleanup())
})

function renderPage({
  plan = 'professional',
  permissions = [DatasetACLPermission.Use],
}: {
  plan?: CloudPlan
  permissions?: NonNullable<ReturnType<typeof createDatasetFixture>['permission_keys']>
} = {}) {
  const queryClient = createConsoleQueryClient()
  queryClient.setQueryData(
    consoleQuery.rag.pipelines.byPipelineId.workflows.publish.get.queryKey({
      input: { params: { pipeline_id: 'pipeline-1' } },
    }),
    createWorkflowResponseFixture({
      graph: {
        nodes: [
          createNode({
            id: 'source',
            data: {
              ...datasourceDefault.defaultValue,
              type: BlockEnum.DataSource,
              title: 'Local documents',
              provider_type: DatasourceType.localFile,
              provider_name: 'upload-file',
              datasource_name: 'upload-file',
              datasource_label: 'Local documents',
              plugin_id: '',
              fileExtensions: ['pdf'],
            },
          }),
        ],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
      },
    }),
  )
  queryClient.setQueryData(
    consoleQuery.files.upload.get.queryKey(),
    createFileUploadConfigFixture(),
  )
  queryClient.setQueryData(consoleQuery.files.supportType.get.queryKey(), {
    allowed_extensions: ['pdf'],
  })
  renderWithConsoleQuery(
    <NuqsTestingAdapter>
      {/* oxlint-disable-next-line eslint-react/no-context-provider -- use-context-selector contexts are not React 19 context components. */}
      <DatasetDetailContext.Provider
        value={{
          dataset: createDatasetFixture({
            id: 'dataset-1',
            pipeline_id: 'pipeline-1',
            permission_keys: permissions,
          }),
        }}
      >
        <CreateFromPipeline />
      </DatasetDetailContext.Provider>
    </NuqsTestingAdapter>,
    {
      queryClient,
      systemFeatures: { deployment_edition: 'CLOUD' },
      features: { billing: { subscription: { plan } } },
      workspacePermissionKeys: ['dataset.create_and_management'],
    },
  )
}

const nextButton = () => screen.getByRole('button', { name: 'datasetCreation.stepOne.button' })
async function uploadDocument(user: ReturnType<typeof userEvent.setup>) {
  await user.upload(
    await screen.findByLabelText('datasetCreation.stepOne.uploader.browse'),
    new File(['document'], 'Guide.pdf', { type: 'application/pdf' }),
  )
}

it('redirects users without document-use permission before offering an upload', async () => {
  renderPage({ permissions: [DatasetACLPermission.Edit] })
  await waitFor(() => expect(api.replace).toHaveBeenCalledWith('/datasets/dataset-1/documents'))
  expect(screen.queryByLabelText('datasetCreation.stepOne.uploader.browse')).not.toBeInTheDocument()
  expect(api.upload).not.toHaveBeenCalled()
})

it('keeps Sandbox users on source selection until an unavailable capacity check succeeds on retry', async () => {
  const user = userEvent.setup()
  api.capacity.mockResolvedValueOnce({ size: 0, limit: 50, usage_unknown: true })
  renderPage({ plan: 'sandbox' })
  expect(nextButton()).toBeDisabled()
  await uploadDocument(user)
  expect(await screen.findByRole('alert')).toHaveTextContent('billing.plansCommon.unavailable')
  expect(nextButton()).toBeDisabled()
  const retry = createDeferred<Awaited<ReturnType<typeof api.capacity>>>()
  api.capacity.mockReturnValueOnce(retry.promise)
  await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))
  await waitFor(() => expect(api.capacity).toHaveBeenCalledTimes(2))
  expect(nextButton()).toBeDisabled()
  await act(async () => retry.resolve({ size: 0, limit: 50, usage_unknown: false }))
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  await user.click(nextButton())
  expect(
    await screen.findByRole('button', { name: 'datasetPipeline.operations.saveAndProcess' }),
  ).toBeEnabled()
})

it('lets paid users advance after an upload even when capacity usage is unknown', async () => {
  const user = userEvent.setup()
  api.capacity.mockResolvedValueOnce({ size: 0, limit: 100, usage_unknown: true })
  renderPage()
  await uploadDocument(user)
  await waitFor(() => expect(nextButton()).toBeEnabled())
  expect(api.capacity).toHaveBeenCalledOnce()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  await user.click(nextButton())
  expect(
    await screen.findByRole('button', { name: 'datasetPipeline.operations.saveAndProcess' }),
  ).toBeEnabled()
})
