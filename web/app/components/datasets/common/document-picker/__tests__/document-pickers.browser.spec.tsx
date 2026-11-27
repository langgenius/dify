import type { DocumentWithSegmentsResponse } from '@dify/contracts/api/console/datasets/types.gen'
import type { DocumentItem } from '@/models/datasets'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { ChunkingMode, DataSourceType } from '@/models/datasets'
import { TEST_DATASET_ID } from '@/test/console/ids'
import { createDeferred } from '@/test/deferred'
import { apiError, setupFakeApi } from '@/test/fake-api'
import { DocumentPicker } from '../index'
import PreviewDocumentPicker from '../preview-document-picker'

const createDocument = (
  overrides: Partial<DocumentWithSegmentsResponse> = {},
): DocumentWithSegmentsResponse => ({
  id: 'doc-1',
  position: 1,
  data_source_type: DataSourceType.FILE,
  data_source_info: {
    upload_file: {
      id: 'file-1',
      name: 'document.pdf',
      size: 1024,
      extension: 'pdf',
      mime_type: 'application/pdf',
      created_by: 'user-1',
      created_at: 1700000000,
    },
    job_id: 'job-1',
    url: '',
  },
  dataset_process_rule_id: 'rule-1',
  name: 'Document 1',
  created_from: 'web',
  created_by: 'user-1',
  created_at: 1700000000,
  indexing_status: 'completed',
  display_status: 'enabled',
  doc_form: ChunkingMode.text,
  enabled: true,
  word_count: 1000,
  archived: false,
  hit_count: 0,
  data_source_detail_dict: {
    upload_file: {
      id: 'file-1',
      name: 'document.pdf',
      size: 1024,
      extension: 'pdf',
      mime_type: 'application/pdf',
      created_by: 'user-1',
      created_at: 1700000000,
    },
  },
  ...overrides,
})

const CUSTOM_DATASET_ID = '8e0d2a4f-5b2c-4d3e-9f4a-2b3c4d5e6f70'

const initialDocuments = [
  createDocument({ id: 'doc-1', name: 'Document 1' }),
  createDocument({ id: 'doc-2', name: 'Document 2' }),
]

function response(data = initialDocuments) {
  return { data, total: data.length, page: 1, limit: 20, has_more: false }
}

async function renderDocumentPicker(
  props: Partial<React.ComponentProps<typeof DocumentPicker>> = {},
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <DocumentPicker
        datasetId={TEST_DATASET_ID}
        currentDocument={createDocument({ id: 'doc-1', name: 'Document 1' })}
        {...props}
      />
    </QueryClientProvider>,
  )
}

const previewDocuments: DocumentItem[] = [
  { id: 'document-1', name: 'First document', extension: 'pdf' },
  { id: 'document-2', name: 'Second document', extension: 'txt' },
]

function PreviewOwner({ files = previewDocuments }: { files?: DocumentItem[] }) {
  const [selected, setSelected] = useState<DocumentItem>()
  return (
    <>
      <PreviewDocumentPicker value={selected} files={files} onChange={setSelected} />
      <output aria-label="Selected document">{selected?.name}</output>
    </>
  )
}

const fake = setupFakeApi(() => ({
  console: { datasets: { byDatasetId: { documents: { get: async () => response() } } } },
}))

it('shows the current document contract and links every available document', async () => {
  const screen = await renderDocumentPicker({
    currentDocument: createDocument({
      id: 'doc-1',
      name: 'Current Document',
      doc_form: ChunkingMode.parentChild,
    }),
    parentMode: 'paragraph',
  })

  const trigger = screen.getByRole('button', { name: 'Current Document' })
  await expect.element(trigger).toMatchTextContent(/dataset\.chunkingMode\.parentChild/)
  await expect.element(trigger).toMatchTextContent(/dataset\.parentMode\.paragraph/)
  await trigger.click()

  const current = screen.getByRole('menuitem', { name: 'Document 1' })
  await expect
    .element(current)
    .toHaveAttribute('href', `/datasets/${TEST_DATASET_ID}/documents/doc-1`)
  await expect.element(current).toHaveAttribute('aria-current', 'page')
  await expect
    .element(screen.getByRole('menuitem', { name: 'Document 2' }))
    .toHaveAttribute('href', `/datasets/${TEST_DATASET_ID}/documents/doc-2`)
})

it('shows only settled search results while keeping native keyboard focus in the menu', async () => {
  const pending = createDeferred<ReturnType<typeof response>>()
  fake.console.datasets.byDatasetId.documents.get.mockImplementation(({ params, query }) =>
    params.dataset_id === CUSTOM_DATASET_ID && query?.keyword === 'report'
      ? pending.promise
      : response(),
  )
  const screen = await renderDocumentPicker({ datasetId: CUSTOM_DATASET_ID })

  await screen.getByRole('button', { name: 'Document 1' }).click()
  await expect.element(screen.getByRole('menuitem', { name: 'Document 2' })).toBeVisible()
  const search = screen.getByRole('searchbox', { name: 'common.operation.search' })
  await search.fill('report')

  await expect.element(screen.getByRole('menuitem')).not.toBeInTheDocument()
  await expect.element(screen.getByRole('status')).toMatchTextContent('common.loading')
  await userEvent.keyboard('{ArrowDown}')
  await expect.element(search).toHaveFocus()

  pending.resolve(response([createDocument({ id: 'report-id', name: 'Quarterly report' })]))
  const result = screen.getByRole('menuitem', { name: 'Quarterly report' })
  await expect
    .element(result)
    .toHaveAttribute('href', `/datasets/${CUSTOM_DATASET_ID}/documents/report-id`)
  await expect.element(search).toHaveFocus()
})

it('announces a failed search and retries without closing the menu', async () => {
  fake.console.datasets.byDatasetId.documents.get.mockRejectedValueOnce(
    apiError({ status: 503, code: 'SERVICE_UNAVAILABLE', message: 'Search unavailable' }),
  )
  const screen = await renderDocumentPicker()

  const trigger = screen.getByRole('button', { name: 'Document 1' })
  await trigger.click()
  await expect.element(screen.getByRole('status')).toMatchTextContent('common.dynamicSelect.error')
  await screen.getByRole('menuitem', { name: 'common.operation.retry' }).click()

  await expect.element(screen.getByRole('menuitem', { name: 'Document 2' })).toBeVisible()
  await expect.element(trigger).toHaveAttribute('aria-expanded', 'true')
  await expect.element(screen.getByRole('status')).toBeEmptyDOMElement()
})

it('clears the search only after the public menu closes and reopens', async () => {
  const screen = await renderDocumentPicker()
  const trigger = screen.getByRole('button', { name: 'Document 1' })
  await trigger.click()
  await screen.getByRole('searchbox', { name: 'common.operation.search' }).fill('missing')
  await userEvent.keyboard('{Escape}')
  await expect.element(screen.getByRole('searchbox')).not.toBeInTheDocument()
  await expect.element(trigger).toHaveFocus()

  await trigger.click()
  await expect
    .element(screen.getByRole('searchbox', { name: 'common.operation.search' }))
    .toHaveValue('')
  await expect.element(screen.getByRole('menuitem', { name: 'Document 2' })).toBeVisible()
})

it('replaces a preview picker loading state with the selected document and restores focus', async () => {
  const screen = await render(<PreviewOwner files={[]} />)
  const trigger = screen.getByRole('button', { name: /--/ })
  await trigger.click()
  await expect.element(screen.getByRole('progressbar')).toBeVisible()

  await screen.rerender(<PreviewOwner />)
  await screen.getByRole('button', { name: 'Second document' }).click()
  await expect
    .element(screen.getByRole('status', { name: 'Selected document' }))
    .toHaveTextContent('Second document')
  await expect.element(screen.getByRole('button', { name: /Second document/ })).toHaveFocus()
})
