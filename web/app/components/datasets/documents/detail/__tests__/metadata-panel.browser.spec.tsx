import type { Locator } from 'vite-plus/test/browser'
import { zDocumentDetailResponse } from '@dify/contracts/api/console/datasets/zod.gen'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import DatasetDetailContext from '@/context/dataset-detail'
import { EventEmitterContextProvider } from '@/context/event-emitter-provider'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createDatasetFixture } from '@/test/fixtures/dataset'
import { createFileUploadConfigFixture } from '@/test/fixtures/file-upload-config'
import { DatasetACLPermission } from '@/utils/permission'
import { DataType } from '../../../metadata/types'
import DocumentDetail from '../index'

// Enough fields that the metadata panel overflows the viewport and renders its scrollbar.
const fields = Array.from({ length: 14 }, (_, i) => ({
  id: `field-${i + 1}`,
  name: `field_${i + 1}`,
  type: DataType.string,
  value: `A long metadata value for field ${i + 1} that wraps onto a second line`,
}))
const save = vi.fn()

vi.mock('@/next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/next/navigation')>()),
  useParams: () => ({ datasetId: 'ds-1', documentId: 'doc-1' }),
  usePathname: () => '/datasets/ds-1/documents/doc-1',
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'datasets.byDatasetId.documents.byDocumentId.segments.get': async () => ({
        data: [],
        total: 0,
        total_pages: 0,
        page: 1,
        limit: 10,
      }),
      'datasets.byDatasetId.metadata.get': async () => ({
        doc_metadata: fields,
        built_in_field_enabled: false,
      }),
      'datasets.byDatasetId.documents.metadata.post': (input) => save(input),
    }),
  }
})

const documentDetail = zDocumentDetailResponse.parse({
  id: 'doc-1',
  name: 'video-transcript.txt',
  display_status: 'available',
  enabled: true,
  archived: false,
  doc_form: 'text_model',
  data_source_type: 'upload_file',
  data_source_info: { upload_file: { extension: 'txt' } },
  error: '',
  document_process_rule: null,
  dataset_process_rule: null,
})

const renderDocumentDetail = async () => {
  const { queryClient, wrapper: Wrapper } = createConsoleQueryWrapper({
    workspacePermissionKeys: [],
  })
  const document = consoleQuery.datasets.byDatasetId.documents.byDocumentId.get
  const params = { dataset_id: 'ds-1', document_id: 'doc-1' }
  queryClient.setQueryData(
    document.queryKey({ input: { params, query: { metadata: 'without' } } }),
    documentDetail,
  )
  queryClient.setQueryData(document.queryKey({ input: { params, query: { metadata: 'only' } } }), {
    id: 'doc-1',
    doc_metadata: fields,
  })
  queryClient.setQueryData(
    consoleQuery.files.upload.get.queryKey(),
    createFileUploadConfigFixture(),
  )
  const dataset = createDatasetFixture({
    id: 'ds-1',
    embedding_available: true,
    permission_keys: [DatasetACLPermission.Edit],
  })
  return render(
    <Wrapper>
      {/* oxlint-disable-next-line eslint-react/no-context-provider -- This use-context-selector context requires its Provider. */}
      <DatasetDetailContext.Provider value={{ dataset }}>
        <EventEmitterContextProvider>
          <div style={{ height: '100vh' }}>
            <DocumentDetail datasetId="ds-1" documentId="doc-1" />
          </div>
        </EventEmitterContextProvider>
      </DatasetDetailContext.Provider>
    </Wrapper>,
  )
}

// Press at the control's rightmost pixel column: the strip an overlay scrollbar would cover.
const clickRightEdge = async (control: Locator) => {
  const { width, height } = control.element().getBoundingClientRect()
  await userEvent.click(control, { position: { x: width - 1, y: height / 2 } })
}

beforeEach(() => {
  save.mockReset().mockResolvedValue({ result: 'success' })
})

it('keeps edit controls clickable beside the metadata scrollbar and reaches the last field', async () => {
  await page.viewport(1280, 640)
  const screen = await renderDocumentDetail()
  await screen.getByRole('button', { name: 'common.operation.edit' }).click()

  const removeButtons = screen.getByRole('button', { name: 'common.operation.remove' })
  await expect.element(removeButtons.nth(fields.length - 1)).toBeInTheDocument()

  // The last row starts below the fold, so this also proves the panel scrolls to it.
  await clickRightEdge(removeButtons.nth(fields.length - 1))
  await expect.poll(() => removeButtons.elements().length).toBe(fields.length - 1)

  const saveButton = screen.getByRole('button', { name: 'common.operation.save' })
  await clickRightEdge(saveButton)
  await expect.poll(() => save.mock.calls.length).toBe(1)
  expect(save.mock.calls[0]?.[0]).toMatchObject({
    body: {
      operation_data: [{ document_id: 'doc-1', metadata_list: fields.slice(0, fields.length - 1) }],
    },
  })
  await expect.element(saveButton).not.toBeInTheDocument()
})
