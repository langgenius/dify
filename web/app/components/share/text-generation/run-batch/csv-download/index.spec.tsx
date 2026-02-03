import { fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import CSVDownload from './index'

const mockDownloadCSV = vi.fn()

vi.mock('@/utils/csv', () => ({
  downloadCSV: (...args: unknown[]) => mockDownloadCSV(...args),
}))

describe('CSVDownload', () => {
  const vars = [{ name: 'prompt' }, { name: 'context' }]

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render table headers and sample row for each variable', () => {
    render(<CSVDownload vars={vars} />)

    expect(screen.getByText('share.generation.csvStructureTitle')).toBeInTheDocument()
    expect(screen.getAllByRole('row')[0].children).toHaveLength(2)
    expect(screen.getByText('prompt share.generation.field')).toBeInTheDocument()
    expect(screen.getByText('context share.generation.field')).toBeInTheDocument()
  })

  it('should render download template button', () => {
    render(<CSVDownload vars={vars} />)

    expect(screen.getByText('share.generation.downloadTemplate')).toBeInTheDocument()
    expect(screen.getByRole('button')).toBeInTheDocument()
  })

  it('should call downloadCSV with template data when clicked', () => {
    render(<CSVDownload vars={vars} />)

    fireEvent.click(screen.getByRole('button'))

    expect(mockDownloadCSV).toHaveBeenCalledWith(
      [{ prompt: '', context: '' }],
      'template',
      { bom: true },
    )
  })
})
