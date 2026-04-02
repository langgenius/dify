import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import Crawling from '../crawling'

describe('Crawling', () => {
  it('should render crawl progress', () => {
    render(<Crawling crawledNum={5} totalNum={10} />)
    expect(screen.getByText(/5/)).toBeInTheDocument()
    expect(screen.getByText(/10/)).toBeInTheDocument()
  })

  it('should render total page scraped label', () => {
    render(<Crawling crawledNum={0} totalNum={0} />)
    expect(screen.getByText(/stepOne\.website\.totalPageScraped/)).toBeInTheDocument()
  })

  it('should apply custom className', () => {
    const { container } = render(<Crawling crawledNum={1} totalNum={5} className="custom" />)
    expect(container.querySelector('.custom')).toBeInTheDocument()
  })
})
