import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import BreadcrumbItem from '../item'

describe('BreadcrumbItem', () => {
  const defaultProps = {
    name: 'Documents',
    index: 2,
    handleClick: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render name', () => {
    render(<BreadcrumbItem {...defaultProps} />)
    expect(screen.getByText('Documents')).toBeInTheDocument()
  })

  it('should show separator by default', () => {
    render(<BreadcrumbItem {...defaultProps} />)
    expect(screen.getByText('/')).toBeInTheDocument()
  })

  it('should hide separator when showSeparator is false', () => {
    render(<BreadcrumbItem {...defaultProps} showSeparator={false} />)
    expect(screen.queryByText('/')).not.toBeInTheDocument()
  })

  it('should call handleClick with index on click', () => {
    render(<BreadcrumbItem {...defaultProps} />)
    fireEvent.click(screen.getByText('Documents'))
    expect(defaultProps.handleClick).toHaveBeenCalledWith(2)
  })

  it('should not call handleClick when disabled', () => {
    render(<BreadcrumbItem {...defaultProps} disabled={true} />)
    fireEvent.click(screen.getByText('Documents'))
    expect(defaultProps.handleClick).not.toHaveBeenCalled()
  })

  it('should apply active styling', () => {
    render(<BreadcrumbItem {...defaultProps} isActive={true} />)
    const btn = screen.getByRole('button')
    expect(btn.className).toContain('system-sm-medium')
  })
})
