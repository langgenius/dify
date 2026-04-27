import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Bucket from '../bucket'

describe('Bucket', () => {
  const defaultProps = {
    bucketName: 'my-bucket',
    handleBackToBucketList: vi.fn(),
    handleClickBucketName: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render bucket name', () => {
    render(<Bucket {...defaultProps} />)
    expect(screen.getByText('my-bucket'))!.toBeInTheDocument()
  })

  it('should render bucket icon', () => {
    const { container } = render(<Bucket {...defaultProps} />)
    expect(container.querySelector('.i-custom-public-knowledge-online-drive-buckets-gray')).toBeInTheDocument()
  })

  it('should call handleBackToBucketList on icon button click', () => {
    render(<Bucket {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'datasetPipeline.onlineDrive.breadcrumbs.allBuckets' }))
    expect(defaultProps.handleBackToBucketList).toHaveBeenCalledOnce()
  })

  it('should call handleClickBucketName on name click', () => {
    render(<Bucket {...defaultProps} />)
    fireEvent.click(screen.getByText('my-bucket'))
    expect(defaultProps.handleClickBucketName).toHaveBeenCalledOnce()
  })

  it('should not call handleClickBucketName when disabled', () => {
    render(<Bucket {...defaultProps} disabled={true} />)
    fireEvent.click(screen.getByText('my-bucket'))
    expect(defaultProps.handleClickBucketName).not.toHaveBeenCalled()
  })

  it('should show separator by default', () => {
    render(<Bucket {...defaultProps} />)
    const separators = screen.getAllByText('/')
    expect(separators.length).toBeGreaterThanOrEqual(2) // One after icon, one after name
  })
})
