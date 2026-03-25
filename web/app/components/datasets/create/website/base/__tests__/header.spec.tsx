import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Header from '../header'

describe('WebsiteHeader', () => {
  const defaultProps = {
    title: 'Jina Reader',
    docTitle: 'Documentation',
    docLink: 'https://docs.example.com',
    onClickConfiguration: vi.fn(),
    buttonText: 'Config',
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render title', () => {
    render(<Header {...defaultProps} />)
    expect(screen.getByText('Jina Reader')).toBeInTheDocument()
  })

  it('should render doc link with correct href', () => {
    render(<Header {...defaultProps} />)
    const link = screen.getByText('Documentation').closest('a')
    expect(link).toHaveAttribute('href', 'https://docs.example.com')
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('should render configuration button with text when not in pipeline', () => {
    render(<Header {...defaultProps} />)
    expect(screen.getByText('Config')).toBeInTheDocument()
  })

  it('should call onClickConfiguration on button click', () => {
    render(<Header {...defaultProps} />)
    fireEvent.click(screen.getByText('Config').closest('button')!)
    expect(defaultProps.onClickConfiguration).toHaveBeenCalledOnce()
  })

  it('should hide button text when isInPipeline', () => {
    render(<Header {...defaultProps} isInPipeline={true} />)
    expect(screen.queryByText('Config')).not.toBeInTheDocument()
  })
})
