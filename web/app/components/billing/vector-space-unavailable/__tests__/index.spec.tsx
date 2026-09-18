import { fireEvent, render, screen } from '@testing-library/react'
import VectorSpaceUnavailable from '../index'

describe('VectorSpaceUnavailable', () => {
  it('retries the vector-space query', () => {
    const onRetry = vi.fn()

    render(<VectorSpaceUnavailable isRetrying={false} onRetry={onRetry} />)
    fireEvent.click(screen.getByRole('button', { name: 'common.operation.retry' }))

    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('disables retry while the query is running', () => {
    render(<VectorSpaceUnavailable isRetrying onRetry={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'common.operation.retry' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
  })
})
