import type { FeedbackType } from '@/app/components/base/chat/chat/type'
import type { WorkflowProcess } from '@/app/components/base/chat/types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { WorkflowRunningStatus } from '@/app/components/workflow/types'
import { AppSourceType } from '@/service/share'
import GenerationItemActionBar from '../action-bar'

vi.mock('@/app/components/base/action-button', () => ({
  default: ({
    children,
    disabled,
    onClick,
    state,
  }: {
    children: React.ReactNode
    disabled?: boolean
    onClick?: () => void
    state?: string
  }) => (
    <button data-state={state} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
  ActionButtonState: {
    Active: 'active',
    Default: 'default',
    Destructive: 'destructive',
    Disabled: 'disabled',
  },
}))

vi.mock('@/app/components/base/new-audio-button', () => ({
  default: ({ id, voice }: { id: string, voice?: string }) => <div>{`audio:${id}:${voice || ''}`}</div>,
}))

vi.mock('@remixicon/react', () => ({
  RiBookmark3Line: () => <span>bookmark-icon</span>,
  RiClipboardLine: () => <span>copy-icon</span>,
  RiFileList3Line: () => <span>log-icon</span>,
  RiResetLeftLine: () => <span>retry-icon</span>,
  RiSparklingLine: () => <span>more-like-this-icon</span>,
  RiThumbDownLine: () => <span>thumb-down-icon</span>,
  RiThumbUpLine: () => <span>thumb-up-icon</span>,
}))

const createWorkflowProcessData = (overrides: Partial<WorkflowProcess> = {}): WorkflowProcess => ({
  status: WorkflowRunningStatus.Succeeded,
  tracing: [],
  ...overrides,
})

const createProps = (overrides: Partial<React.ComponentProps<typeof GenerationItemActionBar>> = {}): React.ComponentProps<typeof GenerationItemActionBar> => ({
  appSourceType: AppSourceType.webApp,
  currentTab: 'RESULT',
  depth: 1,
  feedback: { rating: null } as FeedbackType,
  isError: false,
  isInWebApp: true,
  isResponding: false,
  isShowTextToSpeech: true,
  isTryApp: false,
  isWorkflow: false,
  messageId: 'message-1',
  moreLikeThis: true,
  onCopy: vi.fn(),
  onFeedback: vi.fn(),
  onMoreLikeThis: vi.fn(),
  onOpenLogModal: vi.fn(),
  onRetry: vi.fn(),
  onSave: vi.fn(),
  supportFeedback: true,
  voice: 'alloy',
  workflowProcessData: createWorkflowProcessData({ resultText: 'done' }),
  ...overrides,
})

describe('GenerationItemActionBar', () => {
  it('should render non-web log actions and invoke the corresponding handlers', async () => {
    const user = userEvent.setup()
    const onOpenLogModal = vi.fn()
    const onCopy = vi.fn()
    const onMoreLikeThis = vi.fn()

    render(
      <GenerationItemActionBar
        {...createProps({
          appSourceType: AppSourceType.webApp,
          isInWebApp: false,
          onCopy,
          onMoreLikeThis,
          onOpenLogModal,
        })}
      />,
    )

    await user.click(screen.getByText('log-icon'))
    await user.click(screen.getByText('more-like-this-icon'))
    await user.click(screen.getByText('copy-icon'))

    expect(onOpenLogModal).toHaveBeenCalledTimes(1)
    expect(onMoreLikeThis).toHaveBeenCalledTimes(1)
    expect(onCopy).toHaveBeenCalledTimes(1)
    expect(screen.getByText('audio:message-1:alloy')).toBeInTheDocument()
  })

  it('should render retry, save, and feedback controls for web apps', async () => {
    const user = userEvent.setup()
    const onRetry = vi.fn()
    const onSave = vi.fn()
    const onFeedback = vi.fn()

    render(
      <GenerationItemActionBar
        {...createProps({
          isError: true,
          onRetry,
          onSave,
          supportFeedback: false,
        })}
      />,
    )

    await user.click(screen.getByText('retry-icon'))
    await user.click(screen.getByText('bookmark-icon'))

    expect(onRetry).toHaveBeenCalledTimes(1)
    expect(onSave).not.toHaveBeenCalled()

    render(<GenerationItemActionBar {...createProps({ onSave })} />)

    await user.click(screen.getAllByText('bookmark-icon').at(-1)!)

    expect(onSave).toHaveBeenCalledWith('message-1')

    render(<GenerationItemActionBar {...createProps({ onFeedback })} />)

    await user.click(screen.getAllByText('thumb-up-icon').at(-1)!)
    await user.click(screen.getAllByText('thumb-down-icon').at(-1)!)

    expect(onFeedback).toHaveBeenCalledWith({ rating: 'like' })
    expect(onFeedback).toHaveBeenCalledWith({ rating: 'dislike' })
  })

  it('should disable more-like-this at the maximum depth and render active feedback state toggles', async () => {
    const user = userEvent.setup()
    const onFeedback = vi.fn()

    render(
      <GenerationItemActionBar
        {...createProps({
          depth: 3,
          feedback: { rating: 'like' },
          onFeedback,
        })}
      />,
    )

    expect(screen.getByText('more-like-this-icon').closest('button')).toBeDisabled()

    await user.click(screen.getByText('thumb-up-icon'))

    expect(onFeedback).toHaveBeenCalledWith({ rating: null })

    render(
      <GenerationItemActionBar
        {...createProps({
          depth: 4,
          feedback: { rating: 'dislike' },
          onFeedback,
        })}
      />,
    )

    await user.click(screen.getAllByText('thumb-down-icon')[0])

    expect(onFeedback).toHaveBeenCalledWith({ rating: null })
    expect(screen.getByText('appDebug.errorMessage.waitForResponse')).toBeInTheDocument()
  })
})
