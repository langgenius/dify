import type { ReactElement } from 'react'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import AnnotationCtrlButton from '../annotation-ctrl-button'

const mockSetShowAnnotationFullModal = vi.fn()
vi.mock('@/context/modal-context', () => ({
  useModalContext: () => ({
    setShowAnnotationFullModal: mockSetShowAnnotationFullModal,
  }),
}))

let mockAnnotatedResponseUsage = 5

const mockAddAnnotation = vi.fn().mockResolvedValue({ id: 'annotation-1' })

vi.mock('@/service/console', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/console')>()),
  consoleClient: {
    apps: {
      byAppId: { annotations: { post: (...args: unknown[]) => mockAddAnnotation(...args) } },
    },
  },
}))

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
  return renderWithConsoleQuery(ui, {
    systemFeatures: { deployment_edition: 'CLOUD' },
    features: { annotation_quota_limit: { size: mockAnnotatedResponseUsage, limit: 100 } },
  })
}

describe('AnnotationCtrlButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAnnotatedResponseUsage = 5
  })

  it('should call onEdit when edit button is clicked', async () => {
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

    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: 'appDebug.feature.annotation.edit' }))

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

    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: 'appDebug.feature.annotation.add' }))

    await waitFor(() => {
      expect(mockAddAnnotation).toHaveBeenCalledWith({
        params: { app_id: 'test-app' },
        body: { message_id: 'msg-1', question: 'test query', answer: 'test answer' },
      })
      expect(onAdded).toHaveBeenCalledWith('annotation-1', '')
    })
  })

  it('should show annotation full modal when annotation limit is reached', async () => {
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

    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: 'appDebug.feature.annotation.add' }))

    expect(mockSetShowAnnotationFullModal).toHaveBeenCalled()
    expect(mockAddAnnotation).not.toHaveBeenCalled()
  })
})
