import type { AppPublisherMenuContentProps } from '../menu-content.types'
import type { AppDetailResponse } from '@/models/app'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { toast } from '@/app/components/base/ui/toast'
import { AppModeEnum } from '@/types/app'
import MenuContentActionsSection from '../menu-content-actions-section'

const mockWorkflowToolConfigureButton = vi.fn()

vi.mock('@/app/components/base/ui/toast', () => ({
  toast: {
    error: vi.fn(),
  },
}))

vi.mock('@/app/components/tools/workflow-tool/configure-button', () => ({
  default: (props: {
    detailNeedUpdate: boolean
    disabled?: boolean
    disabledReason?: string
    handlePublish: (params?: unknown) => void
  }) => {
    mockWorkflowToolConfigureButton(props)
    return (
      <button onClick={() => props.handlePublish({ tool: true })}>
        publish-workflow-tool
      </button>
    )
  },
}))

const createAppDetail = (overrides: Partial<AppDetailResponse> = {}): AppDetailResponse => ({
  description: 'Workflow description',
  icon: '🤖',
  icon_background: '#ffffff',
  icon_type: 'emoji',
  id: 'app-1',
  mode: AppModeEnum.WORKFLOW,
  name: 'Workflow app',
  ...overrides,
} as AppDetailResponse)

const createProps = (overrides: Partial<AppPublisherMenuContentProps> = {}): React.ComponentProps<typeof MenuContentActionsSection> => ({
  appDetail: createAppDetail(),
  appURL: '/apps/app-1',
  disabledFunctionButton: false,
  disabledFunctionTooltip: undefined,
  hasHumanInputNode: false,
  hasTriggerNode: false,
  inputs: [],
  missingStartNode: false,
  onOpenEmbedding: vi.fn(),
  onOpenInExplore: vi.fn(),
  onPublish: vi.fn(),
  onRefreshData: vi.fn(),
  outputs: [],
  published: false,
  publishedAt: 1234,
  toolPublished: false,
  workflowToolDisabled: false,
  workflowToolMessage: undefined,
  ...overrides,
})

describe('MenuContentActionsSection', () => {
  it('should show a toast when explore is requested before publish and render the embed action for chat apps', async () => {
    const user = userEvent.setup()
    const onOpenEmbedding = vi.fn()

    render(
      <MenuContentActionsSection {...createProps({
        appDetail: createAppDetail({ mode: AppModeEnum.CHAT }),
        onOpenEmbedding,
        publishedAt: undefined,
      })}
      />,
    )

    await user.click(screen.getByText('workflow.common.openInExplore'))
    await user.click(screen.getByText('workflow.common.embedIntoSite'))

    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('notPublishedYet'))
    expect(onOpenEmbedding).not.toHaveBeenCalled()
  })

  it('should forward workflow tool publish requests to onPublish', async () => {
    const user = userEvent.setup()
    const onPublish = vi.fn().mockResolvedValue(undefined)

    render(
      <MenuContentActionsSection {...createProps({
        onPublish,
        published: true,
        toolPublished: true,
      })}
      />,
    )

    await user.click(screen.getByText('publish-workflow-tool'))

    expect(mockWorkflowToolConfigureButton.mock.calls[0][0]).toEqual(expect.objectContaining({
      detailNeedUpdate: true,
      disabled: false,
      disabledReason: undefined,
    }))
    expect(onPublish).toHaveBeenCalledWith({ tool: true })
  })
})
