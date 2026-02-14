import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import AnnotationCtrlButton from './annotation-ctrl-button'

const mockSetShowAnnotationFullModal = vi.fn()
vi.mock('@/context/modal-context', () => ({
  useModalContext: () => ({
    setShowAnnotationFullModal: mockSetShowAnnotationFullModal,
  }),
}))

let mockAnnotatedResponseUsage = 5
vi.mock('@/context/provider-context', () => ({
  useProviderContext: () => ({
    plan: {
      usage: { get annotatedResponse() { return mockAnnotatedResponseUsage } },
      total: { annotatedResponse: 100 },
    },
    enableBilling: true,
  }),
}))

const mockAddAnnotation = vi.fn().mockResolvedValue({
  id: 'annotation-1',
  account: { name: 'Test User' },
})

vi.mock('@/service/annotation', () => ({
  addAnnotation: (...args: unknown[]) => mockAddAnnotation(...args),
}))

vi.mock('@/app/components/base/toast', () => ({
  default: { notify: vi.fn() },
}))

describe('AnnotationCtrlButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAnnotatedResponseUsage = 5
  })

  it('should render edit button when cached', () => {
    render(
      <AnnotationCtrlButton
        appId="test-app"
        cached={true}
        query="test query"
        answer="test answer"
        onAdded={vi.fn()}
        onEdit={vi.fn()}
      />,
    )

    expect(screen.getByRole('button')).toBeInTheDocument()
  })

  it('should call onEdit when edit button is clicked', () => {
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

    fireEvent.click(screen.getByRole('button'))

    expect(onEdit).toHaveBeenCalled()
  })

  it('should render add button when not cached and has answer', () => {
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

    expect(screen.getByRole('button')).toBeInTheDocument()
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

    fireEvent.click(screen.getByRole('button'))

    await waitFor(() => {
      expect(mockAddAnnotation).toHaveBeenCalledWith('test-app', {
        message_id: 'msg-1',
        question: 'test query',
        answer: 'test answer',
      })
      expect(onAdded).toHaveBeenCalledWith('annotation-1', 'Test User')
    })
  })

  it('should show annotation full modal when annotation limit is reached', () => {
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

    fireEvent.click(screen.getByRole('button'))

    expect(mockSetShowAnnotationFullModal).toHaveBeenCalled()
    expect(mockAddAnnotation).not.toHaveBeenCalled()
  })
})
