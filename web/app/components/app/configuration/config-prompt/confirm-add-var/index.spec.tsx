import { fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import ConfirmAddVar from './index'

vi.mock('../../base/var-highlight', () => ({
  default: ({ name }: { name: string }) => <span data-testid="var-highlight">{name}</span>,
}))

describe('ConfirmAddVar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render variable names', () => {
    render(<ConfirmAddVar varNameArr={['foo', 'bar']} onConfirm={vi.fn()} onCancel={vi.fn()} onHide={vi.fn()} />)

    const highlights = screen.getAllByTestId('var-highlight')
    expect(highlights).toHaveLength(2)
    expect(highlights[0]).toHaveTextContent('foo')
    expect(highlights[1]).toHaveTextContent('bar')
  })

  it('should trigger cancel actions', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(<ConfirmAddVar varNameArr={['foo']} onConfirm={onConfirm} onCancel={onCancel} onHide={vi.fn()} />)

    fireEvent.click(screen.getByText('common.operation.cancel'))

    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('should trigger confirm actions', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(<ConfirmAddVar varNameArr={['foo']} onConfirm={onConfirm} onCancel={onCancel} onHide={vi.fn()} />)

    fireEvent.click(screen.getByText('common.operation.add'))

    expect(onConfirm).toHaveBeenCalledTimes(1)
  })
})
