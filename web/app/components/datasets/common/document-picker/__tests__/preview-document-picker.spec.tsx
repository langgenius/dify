import type { DocumentItem } from '@/models/datasets'
import { fireEvent, render, screen } from '@testing-library/react'
import PreviewDocumentPicker from '../preview-document-picker'

const documents: DocumentItem[] = [
  { id: 'document-1', name: 'First document', extension: 'pdf' } as DocumentItem,
  { id: 'document-2', name: 'Second document', extension: 'txt' } as DocumentItem,
]

describe('PreviewDocumentPicker', () => {
  it('renders the selected document name', () => {
    render(<PreviewDocumentPicker value={documents[0]} files={documents} onChange={vi.fn()} />)

    expect(screen.getByRole('button', { name: /First document/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
  })

  it('opens the document list and selects a document', async () => {
    const onChange = vi.fn()
    render(<PreviewDocumentPicker value={documents[0]} files={documents} onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: /First document/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Second document' }))

    expect(onChange).toHaveBeenCalledWith(documents[1])
    expect(screen.getByRole('button', { name: /First document/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
  })

  it('renders a placeholder without a selected document', () => {
    render(<PreviewDocumentPicker files={documents} onChange={vi.fn()} />)

    expect(screen.getByRole('button', { name: /--/ })).toBeInTheDocument()
  })

  it('shows loading content when the file list is empty', async () => {
    render(<PreviewDocumentPicker value={documents[0]} files={[]} onChange={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /First document/ }))

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })
})
