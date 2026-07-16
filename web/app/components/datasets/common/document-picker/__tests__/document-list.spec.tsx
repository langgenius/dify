import type { SimpleDocumentDetail } from '@/models/datasets'
import { Combobox } from '@langgenius/dify-ui/combobox'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ChunkingMode, DataSourceType } from '@/models/datasets'
import DocumentList from '../document-list'

vi.mock('../../document-file-icon', () => ({
  default: ({ name, extension }: { name?: string; extension?: string }) => (
    <span>
      {name}.{extension}
    </span>
  ),
}))

const createDocument = (overrides: Partial<SimpleDocumentDetail> = {}): SimpleDocumentDetail => ({
  id: 'doc-1',
  batch: 'batch-1',
  position: 1,
  dataset_id: 'dataset-1',
  data_source_type: DataSourceType.FILE,
  data_source_info: {
    upload_file: {
      id: 'file-1',
      name: 'report.pdf',
      size: 1024,
      extension: 'pdf',
      mime_type: 'application/pdf',
      created_by: 'user-1',
      created_at: Date.now(),
    },
    job_id: 'job-1',
    url: '',
  },
  dataset_process_rule_id: 'rule-1',
  name: 'report',
  created_from: 'web',
  created_by: 'user-1',
  created_at: Date.now(),
  indexing_status: 'completed',
  display_status: 'enabled',
  doc_form: ChunkingMode.text,
  doc_language: 'en',
  enabled: true,
  word_count: 1000,
  archived: false,
  updated_at: Date.now(),
  hit_count: 0,
  data_source_detail_dict: {
    upload_file: {
      name: 'report.pdf',
      extension: 'pdf',
    },
  },
  ...overrides,
})

const renderDocumentList = (list: SimpleDocumentDetail[], onValueChange = vi.fn()) => ({
  onValueChange,
  ...render(
    <Combobox
      open
      items={list}
      itemToStringLabel={(document) => document.name}
      itemToStringValue={(document) => document.id}
      onValueChange={onValueChange}
    >
      <DocumentList />
    </Combobox>,
  ),
})

describe('DocumentList', () => {
  it('renders documents as combobox options', () => {
    renderDocumentList([
      createDocument({ id: 'doc-1', name: 'report' }),
      createDocument({ id: 'doc-2', name: 'data' }),
    ])

    expect(screen.getByRole('option', { name: /report/ })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /data/ })).toBeInTheDocument()
  })

  it('selects a document through the combobox', async () => {
    const user = userEvent.setup()
    const selectedDocument = createDocument({ id: 'doc-1', name: 'report' })
    const { onValueChange } = renderDocumentList([selectedDocument])

    await user.click(screen.getByRole('option', { name: /report/ }))

    expect(onValueChange).toHaveBeenCalledWith(selectedDocument, expect.any(Object))
  })
})
