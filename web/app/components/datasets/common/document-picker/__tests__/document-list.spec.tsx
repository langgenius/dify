import type { DocumentItem } from '@/models/datasets'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import DocumentList from '../document-list'

vi.mock('../../document-file-icon', () => ({
  default: ({ name, extension }: { name?: string, extension?: string }) => (
    <span data-testid="file-icon">
      {name}
      .
      {extension}
    </span>
  ),
}))

describe('DocumentList', () => {
  const mockList = [
    { id: 'doc-1', name: 'report', extension: 'pdf' },
    { id: 'doc-2', name: 'data', extension: 'csv' },
  ] as DocumentItem[]

  const onChange = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render all documents', () => {
    render(<DocumentList list={mockList} onChange={onChange} />)
    expect(screen.getByText('report')).toBeInTheDocument()
    expect(screen.getByText('data')).toBeInTheDocument()
  })

  it('should render file icons', () => {
    render(<DocumentList list={mockList} onChange={onChange} />)
    expect(screen.getAllByTestId('file-icon')).toHaveLength(2)
  })

  it('should call onChange with document on click', () => {
    render(<DocumentList list={mockList} onChange={onChange} />)
    fireEvent.click(screen.getByText('report'))
    expect(onChange).toHaveBeenCalledWith(mockList[0])
  })

  it('should render empty list without errors', () => {
    const { container } = render(<DocumentList list={[]} onChange={onChange} />)
    expect(container.firstChild).toBeInTheDocument()
  })
})
