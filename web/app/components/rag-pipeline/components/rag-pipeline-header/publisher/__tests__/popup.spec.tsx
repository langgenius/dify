import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import Popup from '../popup'

const mockPublishWorkflow = vi.fn().mockResolvedValue({ created_at: '2024-01-01T00:00:00Z' })
const mockPublishAsCustomizedPipeline = vi.fn().mockResolvedValue({})
const mockNotify = vi.fn()
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
vi.mock('next/navigation', () => ({
  useParams: () => ({ datasetId: 'ds-123' }),
  useRouter: () => ({ push: mockPush }),
}))

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode, href: string }) => (
    <a href={href}>{children}</a>
  ),
}))

vi.mock('ahooks', () => ({
  useBoolean: (initial: boolean) => {
    const state = { value: initial }
    return [state.value, {
      setFalse: vi.fn(),
      setTrue: vi.fn(),
    }]
  },
  useKeyPress: vi.fn(),
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

vi.mock('@/app/components/base/toast', () => ({
  useToastContext: () => ({ notify: mockNotify }),
}))

vi.mock('@/app/components/base/button', () => ({
  default: ({ children, onClick, disabled, variant, className }: Record<string, unknown>) => (
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

vi.mock('@/app/components/base/confirm', () => ({
  default: ({ isShow, onConfirm, onCancel, title }: {
    isShow: boolean
    onConfirm: () => void
    onCancel: () => void
    title: string
  }) =>
    isShow
      ? (
          <div data-testid="confirm-modal">
            <span>{title}</span>
            <button data-testid="publish-confirm" onClick={onConfirm}>OK</button>
            <button data-testid="publish-cancel" onClick={onCancel}>Cancel</button>
          </div>
        )
      : null,
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
  useModalContextSelector: () => mockSetShowPricingModal,
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

vi.mock('@/utils/classnames', () => ({
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
      render(<Popup />)

      fireEvent.click(screen.getByText('pipeline.common.publishAs'))

      expect(mockSetShowPricingModal).toHaveBeenCalled()
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
