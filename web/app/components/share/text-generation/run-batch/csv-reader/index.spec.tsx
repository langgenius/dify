import { act, render, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import CSVReader from './index'

let mockAcceptedFile: { name: string } | null = null
let capturedHandlers: Record<string, (payload: any) => void> = {}

vi.mock('react-papaparse', () => ({
  useCSVReader: () => ({
    CSVReader: ({ children, ...handlers }: any) => {
      capturedHandlers = handlers
      return (
        <div data-testid="csv-reader-wrapper">
          {children({
            getRootProps: () => ({ 'data-testid': 'drop-zone' }),
            acceptedFile: mockAcceptedFile,
          })}
        </div>
      )
    },
  }),
}))

describe('CSVReader', () => {
  beforeEach(() => {
    mockAcceptedFile = null
    capturedHandlers = {}
    vi.clearAllMocks()
  })

  it('should display upload instructions when no file selected', async () => {
    const onParsed = vi.fn()
    render(<CSVReader onParsed={onParsed} />)

    expect(screen.getByText('share.generation.csvUploadTitle')).toBeInTheDocument()
    expect(screen.getByText('share.generation.browse')).toBeInTheDocument()

    await act(async () => {
      capturedHandlers.onUploadAccepted?.({ data: [['row1']] })
    })
    expect(onParsed).toHaveBeenCalledWith([['row1']])
  })

  it('should show accepted file name without extension', () => {
    mockAcceptedFile = { name: 'batch.csv' }
    render(<CSVReader onParsed={vi.fn()} />)

    expect(screen.getByText('batch')).toBeInTheDocument()
    expect(screen.getByText('.csv')).toBeInTheDocument()
  })

  it('should toggle hover styling on drag events', async () => {
    render(<CSVReader onParsed={vi.fn()} />)
    const dragEvent = { preventDefault: vi.fn() } as unknown as DragEvent

    await act(async () => {
      capturedHandlers.onDragOver?.(dragEvent)
    })
    await waitFor(() => {
      expect(screen.getByTestId('drop-zone')).toHaveClass('border-components-dropzone-border-accent')
    })

    await act(async () => {
      capturedHandlers.onDragLeave?.(dragEvent)
    })
    await waitFor(() => {
      expect(screen.getByTestId('drop-zone')).not.toHaveClass('border-components-dropzone-border-accent')
    })
  })
})
