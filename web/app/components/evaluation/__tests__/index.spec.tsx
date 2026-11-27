import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { isErrorHandled } from '@/service/handled-error'
import { createHttpError } from '@/service/http-error'
import Evaluation from '../index'

const { mockConfigQuery } = vi.hoisted(() => ({ mockConfigQuery: vi.fn() }))
vi.mock('../queries', () => ({ useEvaluationConfigQuery: mockConfigQuery }))
vi.mock('../components/layout/evaluation-layout', () => ({
  default: () => <p>Evaluation editor</p>,
}))

const unavailable = () =>
  createHttpError(
    { status: 503, statusText: '', headers: new Headers() },
    { message: 'Evaluation unavailable' },
  )

describe('Evaluation', () => {
  it('renders a failed configuration load with a retry and claims it, so it is not also toasted', async () => {
    const user = userEvent.setup()
    const error = unavailable()
    const refetch = vi.fn()
    mockConfigQuery.mockReturnValue({
      data: undefined,
      error,
      isError: true,
      isFetching: false,
      refetch,
    })

    render(<Evaluation resourceType="datasets" resourceId="dataset-1" />)

    expect(screen.getByRole('alert')).toHaveTextContent('Evaluation unavailable')
    expect(screen.queryByText('Evaluation editor')).not.toBeInTheDocument()
    expect(isErrorHandled(error)).toBe(true)
    await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))
    expect(refetch).toHaveBeenCalledOnce()
  })

  it('keeps the editor and leaves a failed refresh of a loaded configuration to the cache', () => {
    const error = unavailable()
    mockConfigQuery.mockReturnValue({
      data: { evaluation_model: null },
      error,
      isError: true,
      isFetching: false,
      refetch: vi.fn(),
    })

    render(<Evaluation resourceType="datasets" resourceId="dataset-1" />)

    expect(screen.getByText('Evaluation editor')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(isErrorHandled(error)).toBe(false)
  })
})
