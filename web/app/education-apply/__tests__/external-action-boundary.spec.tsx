import type { ComponentType } from 'react'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { lazy, StrictMode, Suspense } from 'react'
import { render } from '@/test/console/render'
import { EducationExternalActionBoundary } from '../external-action-boundary'

const mockMutate = vi.fn()
const mockReplace = vi.fn()
const mockMutationState = vi.hoisted(() => ({ isError: false }))
const mockSearchParams = vi.hoisted(() => ({
  value: new URLSearchParams('action=educationReVerify'),
}))

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
  useSearchParams: () => mockSearchParams.value,
}))

vi.mock('@/next/dynamic', () => ({
  default: (loader: () => Promise<ComponentType>, options: { loading?: ComponentType }) => {
    const LazyComponent = lazy(async () => ({ default: await loader() }))
    const Loading = options.loading

    return function DynamicComponent(props: Record<string, unknown>) {
      return (
        <Suspense fallback={Loading ? <Loading /> : null}>
          <LazyComponent {...props} />
        </Suspense>
      )
    }
  },
}))

vi.mock('@/service/use-education', () => ({
  useEducationVerify: () => ({
    isError: mockMutationState.isError,
    mutate: mockMutate,
  }),
}))

vi.mock('@/app/components/full-screen-loading', () => ({
  FullScreenLoading: () => <div>Loading</div>,
}))

vi.mock('../verify-state-modal', () => ({
  default: ({
    confirmText,
    isShow,
    onCancel,
    onConfirm,
  }: {
    confirmText: string
    isShow: boolean
    onCancel: () => void
    onConfirm: () => void
  }) =>
    isShow ? (
      <div role="dialog">
        <button type="button" onClick={onConfirm}>
          {confirmText}
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    ) : null,
}))

describe('EducationExternalActionBoundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockMutationState.isError = false
    mockSearchParams.value = new URLSearchParams('action=educationReVerify')
  })

  it('ignores unsupported actions', () => {
    mockSearchParams.value = new URLSearchParams('action=unknown')

    render(<EducationExternalActionBoundary>Apps</EducationExternalActionBoundary>)

    expect(screen.getByText('Apps')).toBeInTheDocument()
    expect(mockMutate).not.toHaveBeenCalled()
  })

  it('starts re-verification once and replaces the command URL with the token page', async () => {
    mockMutate.mockImplementation(
      (_variables: undefined, options: { onSuccess: (result: { token: string }) => void }) =>
        options.onSuccess({ token: 'education-token' }),
    )

    render(
      <StrictMode>
        <EducationExternalActionBoundary>Apps</EducationExternalActionBoundary>
      </StrictMode>,
    )

    await waitFor(() => {
      expect(mockMutate).toHaveBeenCalledTimes(1)
      expect(mockReplace).toHaveBeenCalledWith('/education-apply?token=education-token')
    })
  })

  it('retries a failed verification only after explicit confirmation', async () => {
    mockMutationState.isError = true
    const user = userEvent.setup()

    render(<EducationExternalActionBoundary>Apps</EducationExternalActionBoundary>)

    await waitFor(() => expect(mockMutate).toHaveBeenCalledTimes(1))
    await user.click(await screen.findByRole('button', { name: 'common.errorBoundary.tryAgain' }))

    expect(mockMutate).toHaveBeenCalledTimes(2)
  })

  it('returns to Apps when the verification error is dismissed', async () => {
    mockMutationState.isError = true
    const user = userEvent.setup()

    render(<EducationExternalActionBoundary>Apps</EducationExternalActionBoundary>)

    await user.click(await screen.findByRole('button', { name: 'Cancel' }))

    expect(mockReplace).toHaveBeenCalledWith('/apps')
  })

  it('canonicalizes the active Education pricing link', async () => {
    mockSearchParams.value = new URLSearchParams('action=educationPricing&utm_source=email')

    render(
      <StrictMode>
        <EducationExternalActionBoundary>Apps</EducationExternalActionBoundary>
      </StrictMode>,
    )

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledTimes(1)
      expect(mockReplace).toHaveBeenCalledWith('/apps?utm_source=email&pricing=open')
    })
    expect(mockMutate).not.toHaveBeenCalled()
  })
})
