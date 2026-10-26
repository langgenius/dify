import type { ReactElement } from 'react'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ModalContextProvider } from '@/context/modal-context-provider'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { createNuqsTestWrapper } from '@/test/nuqs-testing'
import AnnotationCtrlButton from '../annotation-ctrl-button'

let mockAnnotatedResponseUsage = 5

const api = vi.hoisted(() => ({ addAnnotation: vi.fn() }))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'apps.byAppId.annotations.post': api.addAnnotation,
    }),
  }
})

vi.mock('@/app/notifications', () => ({
  default: { notify: vi.fn() },
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}))

function render(ui: ReactElement) {
  const { wrapper: NuqsWrapper } = createNuqsTestWrapper()
  return renderWithConsoleQuery(
    <NuqsWrapper>
      <ModalContextProvider>{ui}</ModalContextProvider>
    </NuqsWrapper>,
    {
      systemFeatures: { deployment_edition: 'CLOUD' },
      features: { annotation_quota_limit: { size: mockAnnotatedResponseUsage, limit: 100 } },
    },
  )
}

describe('AnnotationCtrlButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAnnotatedResponseUsage = 5
    api.addAnnotation.mockResolvedValue({ id: 'annotation-1' })
  })

  it('should call onEdit when edit button is clicked', async () => {
    const user = userEvent.setup()
    const onEdit = vi.fn()
    render(
      <AnnotationCtrlButton
        appId="test-app"
        cached={true}
        query="test query"
        answer="test answer"
        onAdded={vi.fn()}
        onEdit={onEdit}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'appDebug.feature.annotation.edit' }))

    expect(onEdit).toHaveBeenCalled()
  })

  it('should not render any button when not cached and no answer', () => {
    render(
      <AnnotationCtrlButton
        appId="test-app"
        cached={false}
        query="test query"
        answer=""
        onAdded={vi.fn()}
        onEdit={vi.fn()}
      />,
    )

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('should call addAnnotation and onAdded when add button is clicked', async () => {
    const user = userEvent.setup()
    const onAdded = vi.fn()
    render(
      <AnnotationCtrlButton
        appId="test-app"
        messageId="msg-1"
        cached={false}
        query="test query"
        answer="test answer"
        onAdded={onAdded}
        onEdit={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'appDebug.feature.annotation.add' }))

    await waitFor(() => {
      expect(api.addAnnotation).toHaveBeenCalledWith({
        params: { app_id: 'test-app' },
        body: { message_id: 'msg-1', question: 'test query', answer: 'test answer' },
      })
      expect(onAdded).toHaveBeenCalledWith('annotation-1', '')
    })
  })

  it('should show annotation full modal when annotation limit is reached', async () => {
    const user = userEvent.setup()
    mockAnnotatedResponseUsage = 100

    render(
      <AnnotationCtrlButton
        appId="test-app"
        cached={false}
        query="test query"
        answer="test answer"
        onAdded={vi.fn()}
        onEdit={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'appDebug.feature.annotation.add' }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('billing.annotatedResponse.fullTipLine1')).toBeInTheDocument()
    expect(api.addAnnotation).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})
