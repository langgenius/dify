import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Bucket from '../bucket'

vi.mock('@/app/components/base/icons/src/public/knowledge/online-drive', () => ({
  BucketsGray: (props: React.SVGProps<SVGSVGElement>) => <svg data-testid="buckets-gray" {...props} />,
}))
vi.mock('@/app/components/base/tooltip', () => ({
  default: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}))

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
    expect(screen.getByText('my-bucket')).toBeInTheDocument()
  })

  it('should render bucket icon', () => {
    render(<Bucket {...defaultProps} />)
    expect(screen.getByTestId('buckets-gray')).toBeInTheDocument()
  })

  it('should call handleBackToBucketList on icon button click', () => {
    render(<Bucket {...defaultProps} />)
    const buttons = screen.getAllByRole('button')
    fireEvent.click(buttons[0])
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
