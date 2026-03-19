import { render, screen } from '@testing-library/react'
import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import List from './list'

// Mock Item to verify its usage
vi.mock('./item', () => ({
  default: ({ item }: { item: { name: string } }) => (
    <div data-testid="mock-item">
      {item.name}
    </div>
  ),
}))

describe('List', () => {
  const mockList = [
    { id: '1', name: 'Conv 1', inputs: {}, introduction: '' },
    { id: '2', name: 'Conv 2', inputs: {}, introduction: '' },
  ]

  const defaultProps = {
    list: mockList,
    onOperate: vi.fn(),
    onChangeConversation: vi.fn(),
    currentConversationId: '0',
  }

  it('should render all items in the list', () => {
    render(<List {...defaultProps} />)
    const items = screen.getAllByTestId('mock-item')
    expect(items).toHaveLength(2)
    expect(screen.getByText('Conv 1')).toBeInTheDocument()
    expect(screen.getByText('Conv 2')).toBeInTheDocument()
  })

  it('should render title if provided', () => {
    render(<List {...defaultProps} title="PINNED" />)
    expect(screen.getByText('PINNED')).toBeInTheDocument()
  })

  it('should not render title if not provided', () => {
    const { queryByText } = render(<List {...defaultProps} />)
    expect(queryByText('PINNED')).not.toBeInTheDocument()
  })

  it('should pass correct props to Item', () => {
    render(<List {...defaultProps} isPin={true} />)
    expect(screen.getAllByTestId('mock-item')).toHaveLength(2)
  })
})
