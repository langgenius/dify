import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import ConfirmAddVar from './index'

jest.mock('../../base/var-highlight', () => ({
  __esModule: true,
  default: ({ name }: { name: string }) => <span data-testid="var-highlight">{name}</span>,
}))

describe('ConfirmAddVar', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('should render variable names', () => {
    render(<ConfirmAddVar varNameArr={['foo', 'bar']} onConfirm={jest.fn()} onCancel={jest.fn()} onHide={jest.fn()} />)

    const highlights = screen.getAllByTestId('var-highlight')
    expect(highlights).toHaveLength(2)
    expect(highlights[0]).toHaveTextContent('foo')
    expect(highlights[1]).toHaveTextContent('bar')
  })

  it('should trigger cancel actions', () => {
    const onConfirm = jest.fn()
    const onCancel = jest.fn()
    render(<ConfirmAddVar varNameArr={['foo']} onConfirm={onConfirm} onCancel={onCancel} onHide={jest.fn()} />)

    fireEvent.click(screen.getByText('common.operation.cancel'))

    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('should trigger confirm actions', () => {
    const onConfirm = jest.fn()
    const onCancel = jest.fn()
    render(<ConfirmAddVar varNameArr={['foo']} onConfirm={onConfirm} onCancel={onCancel} onHide={jest.fn()} />)

    fireEvent.click(screen.getByText('common.operation.add'))

    expect(onConfirm).toHaveBeenCalledTimes(1)
  })
})
