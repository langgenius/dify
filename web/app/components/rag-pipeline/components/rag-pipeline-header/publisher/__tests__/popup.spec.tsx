import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import Popup from '../popup'

vi.mock('@langgenius/dify-ui/alert-dialog', () => ({
  AlertDialog: ({ children, open, onOpenChange }: { children: React.ReactNode, open?: boolean, onOpenChange?: (open: boolean) => void }) => (
    open
      ? (
          <div role="alertdialog">
            {children}
            <button data-testid="alert-dialog-close" onClick={() => onOpenChange?.(false)}>
              Close
            </button>
          </div>
        )
      : null
  ),
  AlertDialogActions: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  AlertDialogCancelButton: ({ children }: { children?: React.ReactNode }) => <button>{children}</button>,
  AlertDialogConfirmButton: ({ children, onClick, disabled }: {
    children?: React.ReactNode
    onClick?: () => void
    disabled?: boolean
  }) => <button onClick={onClick} disabled={disabled}>{children}</button>,
  AlertDialogContent: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  AlertDialogDescription: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}))

const mockPublishWorkflow = vi.fn().mockResolvedValue({ created_at: '2024-01-01T00:00:00Z' })
const mockPublishAsCustomizedPipeline = vi.fn().mockResolvedValue({})
const toastMocks = vi.hoisted(() => ({
  call: vi.fn(),
  dismiss: vi.fn(),
  update: vi.fn(),
  promise: vi.fn(),
}))

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: Object.assign(toastMocks.call, {
    success: vi.fn((message: string, options?: Record<string, unknown>) => toastMocks.call({ type: 'success', message, ...options })),
    error: vi.fn((message: string, options?: Record<string, unknown>) => toastMocks.call({ type: 'error', message, ...options })),
    warning: vi.fn((message: string, options?: Record<string, unknown>) => toastMocks.call({ type: 'warning', message, ...options })),
    info: vi.fn((message: string, options?: Record<string, unknown>) => toastMocks.call({ type: 'info', message, ...options })),
    dismiss: toastMocks.dismiss,
    update: toastMocks.update,
    promise: toastMocks.promise,
  }),
}))
const mockPush = vi.fn()
const mockHandleCheckBeforePublish = vi.fn().mockResolvedValue(true)
const mockSetPublishedAt = vi.fn()
const mockMutateDatasetRes = vi.fn()
const mockSetShowPricingModal = vi.fn()
const mockInvalidPublishedPipelineInfo = vi.fn()
const mockInvalidDatasetList = vi.fn()
const mockInvalidCustomizedTemplateList = vi.fn()

let mockPublishedAt: string | undefined = '2024-01-01T00:00:00Z'
let mockDraftUpdatedAt: string | undefined = '2024-06-01T00:00:00Z'
let mockPipelineId: string | undefined = 'pipeline-123'
let mockIsAllowPublishAsCustom = true
const mockUseBoolean = vi.hoisted(() => vi.fn())
const mockUseKeyPress = vi.hoisted(() => vi.fn())
vi.mock('@/next/navigation', () => ({
  useParams: () => ({ datasetId: 'ds-123' }),
  useRouter: () => ({ push: mockPush }),
}))

vi.mock('@/next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode, href: string }) => (
    <a href={href}>{children}</a>
  ),
}))

vi.mock('ahooks', () => ({
  useBoolean: (initial: boolean) => mockUseBoolean(initial),
  useKeyPress: (...args: unknown[]) => mockUseKeyPress(...args),
}))

vi.mock('@/app/components/workflow/store', () => ({
  useStore: (selector: (state: Record<string, unknown>) => unknown) => {
    const state = {
      publishedAt: mockPublishedAt,
      draftUpdatedAt: mockDraftUpdatedAt,
      pipelineId: mockPipelineId,
    }
    return selector(state)
  },
  useWorkflowStore: () => ({
    getState: () => ({
      setPublishedAt: mockSetPublishedAt,
    }),
  }),
}))

vi.mock('@langgenius/dify-ui/button', () => ({
  Button: ({ children, onClick, disabled, variant, className }: Record<string, unknown>) => (
    <button
      onClick={onClick as () => void}
      disabled={disabled as boolean}
      data-variant={variant as string}
      className={className as string}
    >
      {children as React.ReactNode}
    </button>
  ),
}))

vi.mock('@/app/components/base/divider', () => ({
  default: () => <hr />,
}))

vi.mock('@/app/components/base/amplitude', () => ({
  trackEvent: vi.fn(),
}))

vi.mock('@/app/components/base/icons/src/public/common', () => ({
  SparklesSoft: () => <span data-testid="sparkles" />,
}))

vi.mock('@/app/components/base/premium-badge', () => ({
  default: ({ children }: { children: React.ReactNode }) => <span data-testid="premium-badge">{children}</span>,
}))

vi.mock('@/app/components/workflow/hooks', () => ({
  useChecklistBeforePublish: () => ({
    handleCheckBeforePublish: mockHandleCheckBeforePublish,
  }),
}))

vi.mock('@/app/components/workflow/shortcuts-name', () => ({
  default: ({ keys }: { keys: string[] }) => <span data-testid="shortcuts">{keys.join('+')}</span>,
}))

vi.mock('@/app/components/workflow/utils', () => ({
  getKeyboardKeyCodeBySystem: () => 'ctrl',
}))

vi.mock('@/context/dataset-detail', () => ({
  useDatasetDetailContextWithSelector: () => mockMutateDatasetRes,
}))

vi.mock('@/context/i18n', () => ({
  useDocLink: () => () => 'https://docs.dify.ai',
}))

vi.mock('@/context/modal-context', () => ({
  useModalContextSelector: <T,>(selector: (state: { setShowPricingModal: typeof mockSetShowPricingModal }) => T) =>
    selector({ setShowPricingModal: mockSetShowPricingModal }),
}))

vi.mock('@/context/provider-context', () => ({
  useProviderContextSelector: () => mockIsAllowPublishAsCustom,
}))

vi.mock('@/hooks/use-api-access-url', () => ({
  useDatasetApiAccessUrl: () => '/api/datasets/ds-123',
}))

vi.mock('@/hooks/use-format-time-from-now', () => ({
  useFormatTimeFromNow: () => ({
    formatTimeFromNow: (time: string) => `formatted:${time}`,
  }),
}))

vi.mock('@/service/knowledge/use-dataset', () => ({
  useInvalidDatasetList: () => mockInvalidDatasetList,
}))

vi.mock('@/service/use-base', () => ({
  useInvalid: () => mockInvalidPublishedPipelineInfo,
}))

vi.mock('@/service/use-pipeline', () => ({
  publishedPipelineInfoQueryKeyPrefix: ['published-pipeline'],
  useInvalidCustomizedTemplateList: () => mockInvalidCustomizedTemplateList,
  usePublishAsCustomizedPipeline: () => ({
    mutateAsync: mockPublishAsCustomizedPipeline,
  }),
}))

vi.mock('@/service/use-workflow', () => ({
  usePublishWorkflow: () => ({
    mutateAsync: mockPublishWorkflow,
  }),
}))

vi.mock('@langgenius/dify-ui/cn', () => ({
  cn: (...args: string[]) => args.filter(Boolean).join(' '),
}))

vi.mock('../../../publish-as-knowledge-pipeline-modal', () => ({
  default: ({ onConfirm, onCancel }: { onConfirm: (name: string, icon: unknown, desc: string) => void, onCancel: () => void }) => (
    <div data-testid="publish-as-modal">
      <button data-testid="publish-as-confirm" onClick={() => onConfirm('My Pipeline', { icon_type: 'emoji' }, 'desc')}>
        Confirm
      </button>
      <button data-testid="publish-as-cancel" onClick={onCancel}>Cancel</button>
    </div>
  ),
}))

vi.mock('@remixicon/react', () => ({
  RiArrowRightUpLine: () => <span />,
  RiHammerLine: () => <span />,
  RiPlayCircleLine: () => <span />,
  RiTerminalBoxLine: () => <span />,
}))

describe('Popup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPublishedAt = '2024-01-01T00:00:00Z'
    mockDraftUpdatedAt = '2024-06-01T00:00:00Z'
    mockPipelineId = 'pipeline-123'
    mockIsAllowPublishAsCustom = true
    mockUseBoolean.mockImplementation((initial: boolean) => [initial, {
      setFalse: vi.fn(),
      setTrue: vi.fn(),
    }])
    mockUseKeyPress.mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Rendering', () => {
    it('should render when published', () => {
      render(<Popup />)

      expect(screen.getByText('workflow.common.latestPublished')).toBeInTheDocument()
      expect(screen.getByText(/workflow\.common\.publishedAt/)).toBeInTheDocument()
    })

    it('should render unpublished state', () => {
      mockPublishedAt = undefined
      render(<Popup />)

      expect(screen.getByText('workflow.common.currentDraftUnpublished')).toBeInTheDocument()
      expect(screen.getByText(/workflow\.common\.autoSaved/)).toBeInTheDocument()
    })

    it('should render publish button with shortcuts', () => {
      render(<Popup />)

      expect(screen.getByText('workflow.common.publishUpdate')).toBeInTheDocument()
      expect(screen.getByTestId('shortcuts')).toBeInTheDocument()
    })

    it('should render "Go to Add Documents" button', () => {
      render(<Popup />)

      expect(screen.getByText('pipeline.common.goToAddDocuments')).toBeInTheDocument()
    })

    it('should render "API Reference" button', () => {
      render(<Popup />)

      expect(screen.getByText('workflow.common.accessAPIReference')).toBeInTheDocument()
    })

    it('should render "Publish As" button', () => {
      render(<Popup />)

      expect(screen.getByText('pipeline.common.publishAs')).toBeInTheDocument()
    })
  })

  describe('Premium Badge', () => {
    it('should not show premium badge when allowed', () => {
      mockIsAllowPublishAsCustom = true
      render(<Popup />)

      expect(screen.queryByTestId('premium-badge')).not.toBeInTheDocument()
    })

    it('should show premium badge when not allowed', () => {
      mockIsAllowPublishAsCustom = false
      render(<Popup />)

      expect(screen.getByTestId('premium-badge')).toBeInTheDocument()
    })
  })

  describe('Navigation', () => {
    it('should navigate to add documents page', () => {
      render(<Popup />)

      fireEvent.click(screen.getByText('pipeline.common.goToAddDocuments'))

      expect(mockPush).toHaveBeenCalledWith('/datasets/ds-123/documents/create-from-pipeline')
    })
  })

  describe('Button disable states', () => {
    it('should disable add documents button when not published', () => {
      mockPublishedAt = undefined
      render(<Popup />)

      const btn = screen.getByText('pipeline.common.goToAddDocuments').closest('button')
      expect(btn).toBeDisabled()
    })

    it('should disable publish-as button when not published', () => {
      mockPublishedAt = undefined
      render(<Popup />)

      const btn = screen.getByText('pipeline.common.publishAs').closest('button')
      expect(btn).toBeDisabled()
    })
  })

  describe('Publish As Knowledge Pipeline', () => {
    it('should show pricing modal when not allowed', () => {
      mockIsAllowPublishAsCustom = false
      const onRequestClose = vi.fn()
      render(<Popup onRequestClose={onRequestClose} />)

      fireEvent.click(screen.getByText('pipeline.common.publishAs'))

      expect(onRequestClose).toHaveBeenCalledTimes(1)
      expect(mockSetShowPricingModal).toHaveBeenCalled()
    })

    it('should request closing the outer popover before opening publish-as modal', () => {
      const onRequestClose = vi.fn()
      const onShowPublishAsKnowledgePipelineModal = vi.fn()
      render(
        <Popup
          onRequestClose={onRequestClose}
          onShowPublishAsKnowledgePipelineModal={onShowPublishAsKnowledgePipelineModal}
        />,
      )

      fireEvent.click(screen.getByText('pipeline.common.publishAs'))

      expect(onRequestClose).toHaveBeenCalledTimes(1)
      expect(onShowPublishAsKnowledgePipelineModal).toHaveBeenCalledTimes(1)
    })
  })

  describe('Overlay cleanup', () => {
    it('should close confirm dialog when alert dialog requests close', () => {
      const hideConfirm = vi.fn()
      mockUseBoolean
        .mockImplementationOnce(() => [true, { setFalse: hideConfirm, setTrue: vi.fn() }])
        .mockImplementationOnce((initial: boolean) => [initial, { setFalse: vi.fn(), setTrue: vi.fn() }])
        .mockImplementationOnce((initial: boolean) => [initial, { setFalse: vi.fn(), setTrue: vi.fn() }])
        .mockImplementationOnce((initial: boolean) => [initial, { setFalse: vi.fn(), setTrue: vi.fn() }])

      render(<Popup />)

      fireEvent.click(screen.getByTestId('alert-dialog-close'))

      expect(hideConfirm).toHaveBeenCalledTimes(1)
    })
  })

  describe('Time formatting', () => {
    it('should format published time', () => {
      render(<Popup />)

      expect(screen.getByText(/formatted:2024-01-01/)).toBeInTheDocument()
    })

    it('should format draft updated time when unpublished', () => {
      mockPublishedAt = undefined
      render(<Popup />)

      expect(screen.getByText(/formatted:2024-06-01/)).toBeInTheDocument()
    })
  })
})
