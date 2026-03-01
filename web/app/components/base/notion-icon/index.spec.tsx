import { render, screen } from '@testing-library/react'
import NotionIcon from '.'

describe('Notion Icon', () => {
  it('applies custom class names', () => {
    const { container } = render(<NotionIcon className="custom-class" />)
    expect(container.firstChild).toHaveClass('custom-class')
  })

  it('renders image on http url', () => {
    render(<NotionIcon src="http://example.com/image.png" />)
    expect(screen.getByAltText('workspace icon')).toHaveAttribute('src', 'http://example.com/image.png')
  })

  it('renders image on https url', () => {
    render(<NotionIcon src="https://example.com/image.png" />)
    expect(screen.getByAltText('workspace icon')).toHaveAttribute('src', 'https://example.com/image.png')
  })

  it('renders div on non-http url', () => {
    render(<NotionIcon src="example.com/image.png" />)
    expect(screen.getByText('example.com/image.png')).toBeInTheDocument()
  })

  it('renders name when no url is provided', () => {
    render(<NotionIcon name="test-name" />)
    expect(screen.getByText('T')).toBeInTheDocument()
  })

  it('renders image on type url for page', () => {
    render(<NotionIcon type="page" src={{ type: 'url', url: 'https://example.com/image.png', emoji: null }} />)
    expect(screen.getByAltText('page icon')).toHaveAttribute('src', 'https://example.com/image.png')
  })

  it('renders blank image on type url if no url is passed for page', () => {
    render(<NotionIcon type="page" src={{ type: 'url', url: null, emoji: null }} />)
    expect(screen.getByAltText('page icon')).not.toHaveAttribute('src')
  })

  it('renders emoji on type emoji for page', () => {
    render(<NotionIcon type="page" src={{ type: 'emoji', url: null, emoji: '🚀' }} />)
    expect(screen.getByText('🚀')).toBeInTheDocument()
  })

  it('renders icon on url for page', () => {
    const { container } = render(<NotionIcon type="page" src="https://example.com/image.png" />)
    expect(container.querySelector('svg')).not.toBeNull()
  })
})
