import type { DocumentItem } from '@/models/datasets'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PreviewDocumentPicker from '../preview-document-picker'

const documents: DocumentItem[] = [
  { id: 'document-1', name: 'First document', extension: 'pdf' } as DocumentItem,
  { id: 'document-2', name: 'Second document', extension: 'txt' } as DocumentItem,
]

describe('PreviewDocumentPicker', () => {
  it('opens the document list and selects a document', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<PreviewDocumentPicker value={documents[0]} files={documents} onChange={onChange} />)

    await user.click(screen.getByRole('button', { name: /First document/ }))
    await user.click(await screen.findByRole('button', { name: 'Second document' }))

    expect(onChange).toHaveBeenCalledWith(documents[1])
    expect(screen.getByRole('button', { name: /First document/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
  })

  it('shows loading until the file list arrives', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<PreviewDocumentPicker files={[]} onChange={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: /--/ }))

    expect(await screen.findByRole('progressbar')).toBeInTheDocument()
    rerender(<PreviewDocumentPicker files={documents} onChange={vi.fn()} />)
    expect(await screen.findByRole('button', { name: 'Second document' })).toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })
})
