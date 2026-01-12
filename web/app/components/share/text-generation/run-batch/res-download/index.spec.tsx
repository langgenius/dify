import { render, screen } from '@testing-library/react'
import * as React from 'react'
import ResDownload from './index'

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

describe('ResDownload', () => {
  const values = [{ text: 'Hello' }]

  beforeEach(() => {
    vi.clearAllMocks()
    capturedProps = undefined
  })

  it('should render desktop download button with CSV downloader props', () => {
    render(<ResDownload isMobile={false} values={values} />)

    expect(screen.getByTestId('csv-downloader')).toBeInTheDocument()
    expect(screen.getByText('common.operation.download')).toBeInTheDocument()
    expect(capturedProps?.data).toEqual(values)
    expect(capturedProps?.filename).toBe('result')
    expect(capturedProps?.bom).toBe(true)
    expect(capturedProps?.type).toBe(mockType.Link)
  })

  it('should render mobile action button without desktop label', () => {
    render(<ResDownload isMobile={true} values={values} />)

    expect(screen.getByTestId('csv-downloader')).toBeInTheDocument()
    expect(screen.queryByText('common.operation.download')).not.toBeInTheDocument()
    expect(screen.getByRole('button')).toBeInTheDocument()
  })
})
