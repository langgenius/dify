import { render, screen } from '@testing-library/react'
import * as React from 'react'
import CSVDownload from './index'

const mockType = { Link: 'mock-link' }
let capturedProps: Record<string, unknown> | undefined

vi.mock('react-papaparse', () => ({
  useCSVDownloader: () => {
    const CSVDownloader = ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => {
      capturedProps = props
      return <div data-testid="csv-downloader" className={props.className as string}>{children}</div>
    }
    return {
      CSVDownloader,
      Type: mockType,
    }
  },
}))

describe('CSVDownload', () => {
  const vars = [{ name: 'prompt' }, { name: 'context' }]

  beforeEach(() => {
    capturedProps = undefined
    vi.clearAllMocks()
  })

  it('should render table headers and sample row for each variable', () => {
    render(<CSVDownload vars={vars} />)

    expect(screen.getByText('share.generation.csvStructureTitle')).toBeInTheDocument()
    expect(screen.getAllByRole('row')[0].children).toHaveLength(2)
    expect(screen.getByText('prompt share.generation.field')).toBeInTheDocument()
    expect(screen.getByText('context share.generation.field')).toBeInTheDocument()
  })

  it('should configure CSV downloader with template data', () => {
    render(<CSVDownload vars={vars} />)

    expect(capturedProps?.filename).toBe('template')
    expect(capturedProps?.type).toBe(mockType.Link)
    expect(capturedProps?.bom).toBe(true)
    expect(capturedProps?.data).toEqual([
      { prompt: '', context: '' },
    ])
    expect(screen.getByText('share.generation.downloadTemplate')).toBeInTheDocument()
  })
})
