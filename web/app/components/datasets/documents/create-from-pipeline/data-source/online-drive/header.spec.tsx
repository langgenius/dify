import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Header from './header'

vi.mock('@remixicon/react', () => ({
  RiBookOpenLine: (props: React.SVGProps<SVGSVGElement>) => <svg data-testid="book-icon" {...props} />,
  RiEqualizer2Line: (props: React.SVGProps<SVGSVGElement>) => <svg data-testid="config-icon" {...props} />,
}))

describe('OnlineDriveHeader', () => {
  const defaultProps = {
    docTitle: 'S3 Guide',
    docLink: 'https://docs.aws.com/s3',
    onClickConfiguration: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render doc link with title', () => {
    render(<Header {...defaultProps} />)
    const link = screen.getByText('S3 Guide').closest('a')
    expect(link).toHaveAttribute('href', 'https://docs.aws.com/s3')
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('should render book and config icons', () => {
    render(<Header {...defaultProps} />)
    expect(screen.getByTestId('book-icon')).toBeInTheDocument()
    expect(screen.getByTestId('config-icon')).toBeInTheDocument()
  })
})
