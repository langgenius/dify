import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import Crawling from '../crawling'

vi.mock('@/app/components/base/icons/src/public/other', () => ({
  RowStruct: (props: React.HTMLAttributes<HTMLDivElement>) => <div data-testid="row-struct" {...props} />,
}))

describe('Crawling', () => {
  it('should render crawled count and total', () => {
    render(<Crawling crawledNum={3} totalNum={10} />)
    expect(screen.getByText(/3/)).toBeInTheDocument()
    expect(screen.getByText(/10/)).toBeInTheDocument()
  })

  it('should render skeleton rows', () => {
    render(<Crawling crawledNum={0} totalNum={5} />)
    expect(screen.getAllByTestId('row-struct')).toHaveLength(4)
  })
})
