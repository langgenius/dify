import type { Locator } from 'vite-plus/test/browser'
import { zDocumentDetailResponse } from '@dify/contracts/api/console/datasets/zod.gen'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import DatasetDetailContext from '@/context/dataset-detail'
import { EventEmitterContextProvider } from '@/context/event-emitter-provider'
import common from '@/i18n/locales/en-US/common.json'
import datasetDocuments from '@/i18n/locales/en-US/dataset-documents.json'
import datasetMessages from '@/i18n/locales/en-US/dataset.json'
import { TEST_DATASET_ID } from '@/test/console/ids'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { setupFakeApi } from '@/test/fake-api'
import { createDatasetFixture } from '@/test/fixtures/dataset'
import { createFileUploadConfigFixture } from '@/test/fixtures/file-upload-config'
import { createTestNavigation } from '@/test/next-navigation'
import { DatasetACLPermission } from '@/utils/permission'
import { DataType } from '../../../metadata/types'
import DocumentDetail from '../index'

vi.unmock('react-i18next')

// Enough fields that the metadata panel overflows the viewport and renders its scrollbar. The last
// one is a time field, whose date picker must shrink to keep its remove button inside the row.
const fields = [
  ...Array.from({ length: 13 }, (_, i) => ({
    id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
    name: `field_${i + 1}`,
    type: DataType.string,
    value: `A long metadata value for field ${i + 1} that wraps onto a second line`,
  })),
  {
    id: '00000000-0000-4000-8000-000000000014',
    name: 'recorded_at',
    type: DataType.time,
    value: 1759780800,
  },
]
const DOCUMENT_ID = '9f1e3b5d-6c3d-4e4f-8a5b-3c4d5e6f7081'

const documentDetail = zDocumentDetailResponse.parse({
  id: DOCUMENT_ID,
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

const fake = setupFakeApi(() => ({
  console: {
    datasets: {
      byDatasetId: {
        documents: {
          byDocumentId: {
            get: ({ query }) =>
              query?.metadata === 'only'
                ? { ...documentDetail, doc_metadata: fields }
                : documentDetail,
            segments: {
              get: () => ({ data: [], total: 0, total_pages: 0, page: 1, limit: 10 }),
            },
          },
          metadata: { post: () => {} },
        },
        metadata: { get: () => ({ doc_metadata: fields, built_in_field_enabled: false }) },
      },
    },
    files: { upload: { get: () => createFileUploadConfigFixture() } },
  },
}))

const renderDocumentDetail = async () => {
  const i18n = createInstance()
  await i18n.init({
    lng: 'en-US',
    keySeparator: false,
    resources: { 'en-US': { common, dataset: datasetMessages, datasetDocuments } },
  })
  const { wrapper: Wrapper } = createConsoleQueryWrapper({
    workspacePermissionKeys: [],
  })
  const dataset = createDatasetFixture({
    id: TEST_DATASET_ID,
    embedding_available: true,
    permission_keys: [DatasetACLPermission.Edit],
  })
  const { NavigationProvider } = createTestNavigation({
    url: `/datasets/${TEST_DATASET_ID}/documents/${DOCUMENT_ID}`,
    params: { datasetId: TEST_DATASET_ID, documentId: DOCUMENT_ID },
  })
  return render(
    <NavigationProvider>
      <Wrapper>
        <I18nextProvider i18n={i18n}>
          {/* oxlint-disable-next-line eslint-react/no-context-provider -- This use-context-selector context requires its Provider. */}
          <DatasetDetailContext.Provider value={{ dataset }}>
            <EventEmitterContextProvider>
              <div className="isolate h-screen">
                <DocumentDetail datasetId={TEST_DATASET_ID} documentId={DOCUMENT_ID} />
              </div>
            </EventEmitterContextProvider>
          </DatasetDetailContext.Provider>
        </I18nextProvider>
      </Wrapper>
    </NavigationProvider>,
  )
}

// Press at the control's rightmost pixel column: the strip an overlay scrollbar would cover.
const clickRightEdge = async (control: Locator) => {
  const { width, height } = control.element().getBoundingClientRect()
  await userEvent.click(control, { position: { x: width - 1, y: height / 2 } })
}

it('keeps edit controls clickable beside the metadata scrollbar and reaches the last field', async () => {
  await page.viewport(1280, 640)
  const screen = await renderDocumentDetail()
  await screen.getByRole('button', { name: 'Edit' }).click()

  const removeButtons = screen.getByRole('button', { name: 'Remove' })
  await expect.element(removeButtons.nth(fields.length - 1)).toBeInTheDocument()

  // The last row starts below the fold, so this also proves the panel scrolls to it.
  await clickRightEdge(removeButtons.nth(fields.length - 1))
  await expect.poll(() => removeButtons.elements().length).toBe(fields.length - 1)

  const saveButton = screen.getByRole('button', { name: 'Save' })
  await clickRightEdge(saveButton)
  const save = fake.console.datasets.byDatasetId.documents.metadata.post
  await expect.poll(() => save).toHaveBeenCalledOnce()
  expect(save.mock.calls[0]![0]).toMatchObject({
    body: {
      operation_data: [
        {
          document_id: DOCUMENT_ID,
          metadata_list: fields
            .slice(0, fields.length - 1)
            .map(({ id, name, value }) => ({ id, name, value })),
        },
      ],
    },
  })
  await expect.element(saveButton).not.toBeInTheDocument()
})

it('returns focus to More after closing the rename dialog from the document menu', async () => {
  const screen = await renderDocumentDetail()
  const more = screen.getByRole('button', { name: 'More', exact: true })
  await more.click()
  await screen.getByRole('menuitem', { name: 'Rename' }).click()
  const dialog = screen.getByRole('dialog', { name: 'Rename' })
  await expect.element(dialog.getByRole('textbox')).toHaveValue(documentDetail.name)
  await expect.element(screen.getByRole('menu')).not.toBeInTheDocument()
  await userEvent.keyboard('{Escape}')
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(more).toHaveFocus()
})
