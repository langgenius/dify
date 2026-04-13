import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Header from '../header'

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
})
