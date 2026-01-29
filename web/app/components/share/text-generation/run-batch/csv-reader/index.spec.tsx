import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import CSVReader from './index'
import { parseCSV } from '@/utils/csv'

vi.mock('@/utils/csv', () => ({
  parseCSV: vi.fn(),
}))

describe('CSVReader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(parseCSV).mockImplementation((_file, options) => {
      options?.complete?.({ data: [['row1', 'row2']] } as any)
    })
  })

  it('should display upload instructions when no file selected', () => {
    const onParsed = vi.fn()
    render(<CSVReader onParsed={onParsed} />)

    expect(screen.getByText('share.generation.csvUploadTitle')).toBeInTheDocument()
    expect(screen.getByText('share.generation.browse')).toBeInTheDocument()
  })

  it('should parse CSV file when file is selected via input', async () => {
    const onParsed = vi.fn()
    render(<CSVReader onParsed={onParsed} />)

    const file = new File(['test,data'], 'batch.csv', { type: 'text/csv' })
    const input = document.querySelector('input[type="file"]') as HTMLInputElement

    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } })
    })

    await waitFor(() => {
      expect(parseCSV).toHaveBeenCalled()
      expect(onParsed).toHaveBeenCalledWith([['row1', 'row2']])
    })
  })

  it('should show accepted file name without extension after upload', async () => {
    const onParsed = vi.fn()
    render(<CSVReader onParsed={onParsed} />)

    const file = new File(['test,data'], 'batch.csv', { type: 'text/csv' })
    const input = document.querySelector('input[type="file"]') as HTMLInputElement

    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } })
    })

    await waitFor(() => {
      expect(screen.getByText('batch')).toBeInTheDocument()
      expect(screen.getByText('.csv')).toBeInTheDocument()
    })
  })

  it('should handle file drop', async () => {
    const onParsed = vi.fn()
    const { container } = render(<CSVReader onParsed={onParsed} />)

    const file = new File(['test,data'], 'dropped.csv', { type: 'text/csv' })
    const dropZone = container.querySelector('div.flex.h-20') as HTMLDivElement

    await act(async () => {
      fireEvent.drop(dropZone, {
        dataTransfer: { files: [file] },
      })
    })

    await waitFor(() => {
      expect(parseCSV).toHaveBeenCalled()
      expect(onParsed).toHaveBeenCalledWith([['row1', 'row2']])
    })
  })
})
