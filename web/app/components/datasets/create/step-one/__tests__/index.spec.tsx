import type { DatasourceProviderAuthResponse } from '@dify/contracts/api/console/auth/types.gen'
import type { ComponentProps } from 'react'
import type { FileItem } from '@/models/datasets'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { DataSourceType } from '@/models/datasets'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { createNuqsTestRenderer } from '@/test/nuqs-testing'
import StepOne from '../index'

const vectorSpace = vi.hoisted(() =>
  vi.fn<typeof import('@/service/console').consoleClient.features.vectorSpace.get>(),
)
vi.mock('@tanstack/react-virtual')
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  const { createFileUploadConfigFixture } = await import('@/test/fixtures/file-upload-config')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'features.vectorSpace.get': vectorSpace,
      'files.upload.get': async () => createFileUploadConfigFixture(),
      'files.supportType.get': async () => ({ allowed_extensions: ['txt'] }),
      'files.byFileId.preview.get': async () => ({ content: 'Uploaded file contents' }),
      'notion.preImport.pages.get': async () => ({
        notion_info: [
          {
            workspace_id: 'workspace-1',
            workspace_name: 'Workspace 1',
            workspace_icon: null,
            pages: [
              {
                page_id: 'page-1',
                page_name: 'Notes',
                parent_id: null,
                page_icon: null,
                is_bound: false,
                type: 'page',
              },
            ],
          },
        ],
      }),
      'notion.pages.byPageId.byPageType.preview.get': async () => ({
        content: 'Notion page contents',
      }),
    }),
  }
})
vi.mock('@/next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/next/navigation')>()),
  useRouter: () => ({ push: vi.fn() }),
}))
vi.mock('@/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/config')>()),
  ENABLE_WEBSITE_FIRECRAWL: true,
  ENABLE_WEBSITE_JINAREADER: false,
  ENABLE_WEBSITE_WATERCRAWL: false,
}))

const notion: DatasourceProviderAuthResponse = {
  author: 'Dify',
  credential_schema: [],
  description: { en_US: 'Notion' },
  label: { en_US: 'Notion' },
  icon: '',
  name: 'notion',
  oauth_schema: null,
  plugin_unique_identifier: 'notion:1',
  provider: 'notion_datasource',
  plugin_id: 'plugin-1',
  credentials_list: [
    {
      id: 'cred-1',
      name: 'Workspace 1',
      avatar_url: null,
      credential: {},
      is_default: true,
      type: 'oauth2',
    },
  ],
}
function uploadedFile(id = 'file-1'): FileItem {
  return {
    fileID: id,
    file: Object.assign(new File(['contents'], `${id}.txt`, { type: 'text/plain' }), {
      id,
      extension: 'txt',
    }),
    progress: 100,
  }
}

const render = createNuqsTestRenderer(renderWithConsoleQuery)
function setup(
  props: Partial<ComponentProps<typeof StepOne>> = {},
  {
    cloud = false,
    plan = 'professional',
    usage = { size: 50, limit: 100, usage_unknown: false },
  }: {
    cloud?: boolean
    plan?: 'sandbox' | 'professional'
    usage?: Awaited<ReturnType<typeof vectorSpace>>
  } = {},
) {
  const queryClient = createConsoleQueryClient()
  queryClient.setQueryData(consoleQuery.features.vectorSpace.get.queryKey(), usage)
  const onStepChange = vi.fn()
  const defaults: ComponentProps<typeof StepOne> = {
    dataSourceType: DataSourceType.FILE,
    dataSourceTypeDisable: false,
    changeType: vi.fn(),
    files: [],
    updateFileList: vi.fn(),
    updateFile: vi.fn(),
    notionPages: [],
    notionCredentialId: 'cred-1',
    updateNotionPages: vi.fn(),
    updateNotionCredentialId: vi.fn(),
    websitePages: [],
    updateWebsitePages: vi.fn(),
    onWebsiteCrawlProviderChange: vi.fn(),
    onWebsiteCrawlJobIdChange: vi.fn(),
    crawlOptions: {
      crawl_sub_pages: true,
      only_main_content: true,
      includes: '',
      excludes: '',
      limit: 10,
      max_depth: '',
      use_sitemap: true,
    },
    onCrawlOptionsChange: vi.fn(),
    authedDataSourceList: [],
    onSetting: vi.fn(),
    onStepChange,
  }
  function SourceStep({
    stepProps = props,
  }: {
    stepProps?: Partial<ComponentProps<typeof StepOne>>
  }) {
    const [type, setType] = useState(props.dataSourceType ?? DataSourceType.FILE)
    return <StepOne {...defaults} {...stepProps} dataSourceType={type} changeType={setType} />
  }
  const view = render(<SourceStep />, {
    queryClient,
    systemFeatures: { deployment_edition: cloud ? 'CLOUD' : 'COMMUNITY' },
    features: { billing: { subscription: { plan } } },
  })
  return {
    ...view,
    rerenderStep: (nextProps: Partial<ComponentProps<typeof StepOne>>) =>
      view.rerender(<SourceStep stepProps={{ ...props, ...nextProps }} />),
    user: userEvent.setup(),
    onStepChange,
  }
}
const nextButton = () => screen.getByRole('button', { name: 'datasetCreation.stepOne.button' })

beforeEach(() => {
  vectorSpace.mockReset().mockResolvedValue({ size: 50, limit: 100, usage_unknown: false })
})

it('restores focus when closing a real file preview but preserves the selected source focus when switching away', async () => {
  const { user } = setup({ files: [uploadedFile()] })
  const trigger = screen.getByRole('button', {
    name: 'datasetCreation.stepOne.filePreview file-1.txt',
  })
  await user.click(trigger)
  const preview = screen.getByRole('region', { name: 'datasetCreation.stepOne.filePreview' })
  expect(await within(preview).findByText('Uploaded file contents')).toBeInTheDocument()
  await user.click(within(preview).getByRole('button', { name: 'common.operation.close' }))
  expect(preview).not.toBeInTheDocument()
  expect(trigger).toHaveFocus()
  await user.click(trigger)
  const source = screen.getByRole('radio', { name: 'datasetCreation.stepOne.dataSourceType.web' })
  await user.click(source)
  expect(
    screen.queryByRole('region', { name: 'datasetCreation.stepOne.filePreview' }),
  ).not.toBeInTheDocument()
  expect(source).toBeChecked()
  expect(source).toHaveFocus()
  expect(nextButton()).toBeDisabled()
})

it.each([
  { name: 'no selected file', files: [] },
  {
    name: 'an upload in progress',
    files: [
      {
        fileID: 'pending',
        file: new File(['contents'], 'pending.txt', { type: 'text/plain' }),
        progress: 50,
      },
    ],
  },
])('blocks the next step with $name', ({ files }) => {
  setup({ files })
  expect(nextButton()).toBeDisabled()
})

it('offers empty creation only for a new dataset and closes its real dialog on cancellation', async () => {
  const { user, unmount } = setup()
  await user.click(
    screen.getByRole('button', { name: 'datasetCreation.stepOne.emptyDatasetCreation' }),
  )
  const dialog = screen.getByRole('dialog', { name: 'datasetCreation.stepOne.modal.title' })
  await user.click(
    within(dialog).getByRole('button', { name: 'datasetCreation.stepOne.modal.cancelButton' }),
  )
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  unmount()
  setup({ datasetId: 'existing-dataset' })
  expect(
    screen.queryByRole('button', { name: 'datasetCreation.stepOne.emptyDatasetCreation' }),
  ).not.toBeInTheDocument()
})

it('requires an upgrade before advancing multiple uploaded files on the sandbox plan', async () => {
  const { user, onStepChange } = setup(
    { files: [uploadedFile('first'), uploadedFile('second')] },
    { cloud: true, plan: 'sandbox' },
  )
  expect(screen.getByText('billing.upgrade.uploadMultipleFiles.title')).toBeInTheDocument()
  await user.click(nextButton())
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  expect(onStepChange).not.toHaveBeenCalled()
})

it('blocks the next step when vector space is full', () => {
  setup(
    { files: [uploadedFile()] },
    { cloud: true, usage: { size: 100, limit: 100, usage_unknown: false } },
  )
  expect(screen.getByText('billing.vectorSpace.fullTip')).toBeInTheDocument()
  expect(nextButton()).toBeDisabled()
})

it('requires a successful usage retry before a sandbox user can continue', async () => {
  const pending = createDeferred<Awaited<ReturnType<typeof vectorSpace>>>()
  vectorSpace.mockReturnValue(pending.promise)
  const { user, onStepChange } = setup(
    { files: [uploadedFile()] },
    { cloud: true, plan: 'sandbox', usage: { size: 100, limit: 100, usage_unknown: true } },
  )
  expect(screen.getByRole('alert')).toHaveTextContent('billing.plansCommon.unavailable')
  expect(screen.queryByText('billing.vectorSpace.fullTip')).not.toBeInTheDocument()
  expect(nextButton()).toBeDisabled()
  await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))
  expect(nextButton()).toBeDisabled()
  await act(async () => pending.resolve({ size: 20, limit: 100, usage_unknown: false }))
  await waitFor(() => expect(nextButton()).toBeEnabled())
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  await user.click(nextButton())
  expect(onStepChange).toHaveBeenCalledOnce()
})

it('allows a paid user to proceed despite unknown vector usage', async () => {
  const { user, onStepChange } = setup(
    { files: [uploadedFile()] },
    { cloud: true, usage: { size: 100, limit: 100, usage_unknown: true } },
  )
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  await user.click(nextButton())
  expect(onStepChange).toHaveBeenCalledOnce()
})

it('replaces the Notion connection prompt when authenticated sources arrive and previews the selected page', async () => {
  const { user, rerenderStep } = setup({ dataSourceType: DataSourceType.NOTION })
  expect(
    screen.getByRole('button', { name: 'datasetCreation.stepOne.connect' }),
  ).toBeInTheDocument()
  rerenderStep({ authedDataSourceList: [notion] })
  expect(await screen.findByRole('combobox', { name: 'Workspace 1' })).toBeInTheDocument()
  expect(nextButton()).toBeDisabled()
  await user.click(await screen.findByText('common.dataSource.notion.selector.preview'))
  expect(await screen.findByText('Notion page contents')).toBeInTheDocument()
})
