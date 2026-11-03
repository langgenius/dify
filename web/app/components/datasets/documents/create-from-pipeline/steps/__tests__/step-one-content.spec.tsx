import type { ComponentProps } from 'react'
import type { Datasource } from '@/app/components/rag-pipeline/components/panel/test-run/types'
import { act, cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { BlockEnum } from '@/app/components/workflow/types'
import { DatasourceType } from '@/models/pipeline'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { createFileUploadConfigFixture } from '@/test/fixtures/file-upload-config'
import { createDataSourceStore } from '../../data-source/store'
import { DataSourceContext } from '../../data-source/store/provider'
import StepOneContent from '../step-one-content'

vi.mock('@/next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/next/navigation')>()),
  useParams: () => ({ datasetId: 'dataset-1' }),
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'rag.pipelines.datasourcePlugins.get': async () => [],
    }),
  }
})

afterEach(async () => {
  await act(async () => cleanup())
})

function renderStep(overrides: Partial<ComponentProps<typeof StepOneContent>> = {}) {
  const datasource: Datasource = {
    nodeId: 'source-1',
    nodeData: {
      type: BlockEnum.DataSource,
      title: 'Documents',
      desc: '',
      provider_type: DatasourceType.localFile,
      plugin_id: 'datasource',
      provider_name: 'source',
      datasource_name: 'documents',
      datasource_label: 'Documents',
      datasource_parameters: {},
      datasource_configurations: {},
      fileExtensions: ['pdf'],
    },
  }
  const props: ComponentProps<typeof StepOneContent> = {
    datasource,
    datasourceType: DatasourceType.localFile,
    pipelineNodes: [{ id: datasource.nodeId, data: datasource.nodeData, position: { x: 0, y: 0 } }],
    supportBatchUpload: true,
    showBatchUploadUpgrade: false,
    isShowVectorSpaceFull: false,
    isShowVectorSpaceUnavailable: false,
    isRetryingVectorSpace: false,
    showSelect: false,
    totalOptions: 0,
    selectedOptions: 0,
    tip: '',
    nextBtnDisabled: false,
    onSelectDataSource: vi.fn(),
    onCredentialChange: vi.fn(),
    onSelectAll: vi.fn(),
    onRetryVectorSpace: vi.fn(),
    onNextStep: vi.fn(),
    ...overrides,
  }
  const queryClient = createConsoleQueryClient()
  queryClient.setQueryData(
    consoleQuery.files.upload.get.queryKey(),
    createFileUploadConfigFixture(),
  )
  queryClient.setQueryData(consoleQuery.files.supportType.get.queryKey(), {
    allowed_extensions: ['pdf'],
  })
  queryClient.setQueryData(consoleQuery.features.vectorSpace.get.queryKey(), {
    size: 50,
    limit: 50,
    usage_unknown: false,
  })
  const onUrlUpdate = vi.fn()
  renderWithConsoleQuery(
    <NuqsTestingAdapter onUrlUpdate={onUrlUpdate}>
      <DataSourceContext value={createDataSourceStore()}>
        <StepOneContent {...props} />
      </DataSourceContext>
    </NuqsTestingAdapter>,
    {
      queryClient,
      systemFeatures: { deployment_edition: 'CLOUD' },
      features: { billing: { subscription: { plan: 'sandbox' } } },
    },
  )
  return { onUrlUpdate }
}

it('offers pricing from the capacity warning alongside the local source form', async () => {
  const user = userEvent.setup()
  const { onUrlUpdate } = renderStep({ isShowVectorSpaceFull: true, nextBtnDisabled: true })
  expect(screen.getByText('billing.vectorSpace.fullTip')).toBeInTheDocument()
  expect(screen.getByText('datasetCreation.stepOne.uploader.button')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'datasetCreation.stepOne.button' })).toBeDisabled()
  await user.click(screen.getByRole('button', { name: 'billing.upgradeBtn.encourage' }))
  await waitFor(() =>
    expect(onUrlUpdate.mock.lastCall?.[0].searchParams.get('pricing')).toBe('open'),
  )
})

it('lets the user retry unavailable capacity and disables advancing', async () => {
  const user = userEvent.setup()
  const onRetryVectorSpace = vi.fn()
  renderStep({ isShowVectorSpaceUnavailable: true, nextBtnDisabled: true, onRetryVectorSpace })
  expect(screen.getByRole('alert')).toHaveTextContent('billing.plansCommon.unavailable')
  await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))
  expect(onRetryVectorSpace).toHaveBeenCalledOnce()
  expect(screen.getByRole('button', { name: 'datasetCreation.stepOne.button' })).toBeDisabled()
})

it('opens pricing from the local-file batch upload restriction', async () => {
  const user = userEvent.setup()
  const { onUrlUpdate } = renderStep({ supportBatchUpload: false, showBatchUploadUpgrade: true })
  await user.click(screen.getByRole('button', { name: 'billing.triggerLimitModal.upgrade' }))
  await waitFor(() =>
    expect(onUrlUpdate.mock.lastCall?.[0].searchParams.get('pricing')).toBe('open'),
  )
})

it('does not infer a paid upgrade from batch upload being unavailable', () => {
  renderStep({ supportBatchUpload: false })
  expect(
    screen.queryByRole('button', { name: 'billing.triggerLimitModal.upgrade' }),
  ).not.toBeInTheDocument()
  expect(screen.queryByText('billing.vectorSpace.fullTip')).not.toBeInTheDocument()
})

it('does not offer a batch upload upgrade before a source is selected', () => {
  renderStep({
    datasource: undefined,
    datasourceType: undefined,
    pipelineNodes: [],
    supportBatchUpload: false,
    showBatchUploadUpgrade: true,
  })
  expect(
    screen.queryByRole('button', { name: 'billing.triggerLimitModal.upgrade' }),
  ).not.toBeInTheDocument()
})
