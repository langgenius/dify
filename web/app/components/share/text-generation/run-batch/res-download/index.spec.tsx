import { fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import ResDownload from './index'

const mockDownloadCSV = vi.fn()

vi.mock('@/utils/csv', () => ({
  downloadCSV: (...args: unknown[]) => mockDownloadCSV(...args),
}))

describe('ResDownload', () => {
  const values = [{ text: 'Hello' }]

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render desktop download button', () => {
    render(<ResDownload isMobile={false} values={values} />)

    expect(screen.getByText('common.operation.download')).toBeInTheDocument()
  })

  it('should render mobile action button without desktop label', () => {
    render(<ResDownload isMobile={true} values={values} />)

    expect(screen.queryByText('common.operation.download')).not.toBeInTheDocument()
  })

  it('should call downloadCSV with correct params when clicked', () => {
    const { container } = render(<ResDownload isMobile={false} values={values} />)

    const outerButton = container.querySelector('button[type="button"]') as HTMLButtonElement
    fireEvent.click(outerButton)

    expect(mockDownloadCSV).toHaveBeenCalledWith(values, 'result', { bom: true })
  })
})
