import type { AppPublisherMenuContentProps } from '../menu-content.types'
import type { AppDetailResponse } from '@/models/app'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultSystemFeatures } from '@/types/feature'
import AppPublisher from '../index'

const mockMenuContent = vi.fn()
const mockUseAppPublisher = vi.fn()

vi.mock('@/app/components/base/portal-to-follow-elem', () => ({
  PortalToFollowElem: ({
    children,
    open,
  }: {
    children: React.ReactNode
    open: boolean
  }) => <div data-testid="portal" data-open={String(open)}>{children}</div>,
  PortalToFollowElemTrigger: ({
    children,
    onClick,
  }: {
    children: React.ReactNode
    onClick?: () => void
  }) => <div onClick={onClick}>{children}</div>,
  PortalToFollowElemContent: ({ children }: { children: React.ReactNode }) => <div data-testid="portal-content">{children}</div>,
}))

vi.mock('@/app/components/app/overview/embedded', () => ({
  default: ({
    isShow,
    onClose,
    appBaseUrl,
    accessToken,
  }: {
    isShow: boolean
    onClose: () => void
    appBaseUrl?: string
    accessToken?: string
  }) => (
    <div data-testid="embedded-modal" data-open={String(isShow)} data-app-base-url={appBaseUrl} data-access-token={accessToken}>
      <button onClick={onClose}>close-embedded</button>
    </div>
  ),
}))

vi.mock('../menu-content', () => ({
  default: (props: AppPublisherMenuContentProps) => {
    mockMenuContent(props)
    return (
      <div data-testid="menu-content">
        <button onClick={props.onOpenEmbedding}>menu-open-embedding</button>
      </div>
    )
  },
}))

vi.mock('../use-app-publisher', () => ({
  useAppPublisher: (...args: unknown[]) => mockUseAppPublisher(...args),
}))

vi.mock('../../app-access-control', () => ({
  default: ({
    onClose,
    onConfirm,
  }: {
    onClose: () => void
    onConfirm: () => void
  }) => (
    <div data-testid="access-control">
      <button onClick={onConfirm}>confirm-access</button>
      <button onClick={onClose}>close-access</button>
    </div>
  ),
}))

const createHookState = () => ({
  accessToken: 'app-token',
  appBaseURL: 'https://apps.example.com',
  appDetail: {
    id: 'app-1',
    site: {
      access_token: 'app-token',
      app_base_url: 'https://apps.example.com',
    },
  } as AppDetailResponse | undefined,
  appURL: '/apps/app-1',
  closeAppAccessControl: vi.fn(),
  closeEmbeddingModal: vi.fn(),
  crossAxisOffset: 8,
  debugWithMultipleModel: false,
  disabled: false,
  disabledFunctionButton: false,
  disabledFunctionTooltip: undefined,
  draftUpdatedAt: 5678,
  embeddingModalOpen: false,
  formatTimeFromNow: (time: number) => `from-now:${time}`,
  handleAccessControlUpdate: vi.fn(),
  handleOpenEmbedding: vi.fn(),
  handleOpenInExplore: vi.fn(),
  handlePublish: vi.fn(),
  handlePublishToMarketplace: vi.fn(),
  handleRestore: vi.fn(),
  handleTrigger: vi.fn(),
  hasHumanInputNode: false,
  hasTriggerNode: false,
  inputs: [],
  isAppAccessSet: true,
  isChatApp: false,
  isGettingAppWhiteListSubjects: false,
  isGettingUserCanAccessApp: false,
  missingStartNode: false,
  multipleModelConfigs: [],
  onRefreshData: vi.fn(),
  open: false,
  outputs: [],
  publishDisabled: false,
  publishLoading: false,
  published: false,
  publishedAt: 1234,
  publishingToMarketplace: false,
  setOpen: vi.fn(),
  showAppAccessControl: false,
  showAppAccessControlModal: vi.fn(),
  startNodeLimitExceeded: false,
  systemFeatures: defaultSystemFeatures,
  toolPublished: false,
  upgradeHighlightStyle: { color: 'red' },
  workflowToolAvailable: true,
  workflowToolDisabled: false,
  workflowToolMessage: undefined,
})

describe('AppPublisher', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseAppPublisher.mockReturnValue(createHookState())
  })

  it('should render the publish trigger and forward state into the menu content', () => {
    render(<AppPublisher />)

    const menuContentProps = mockMenuContent.mock.calls[0][0] as AppPublisherMenuContentProps

    expect(screen.getByRole('button', { name: 'workflow.common.publish' })).toBeInTheDocument()
    expect(screen.getByTestId('portal')).toHaveAttribute('data-open', 'false')
    expect(menuContentProps).toEqual(expect.objectContaining({
      appURL: '/apps/app-1',
      publishedAt: 1234,
      workflowToolDisabled: false,
    }))
    expect(screen.getByTestId('embedded-modal')).toHaveAttribute('data-app-base-url', 'https://apps.example.com')
    expect(screen.getByTestId('embedded-modal')).toHaveAttribute('data-access-token', 'app-token')
  })

  it('should invoke the trigger handler when the publish button is clicked', () => {
    const state = createHookState()
    mockUseAppPublisher.mockReturnValue(state)

    render(<AppPublisher />)

    fireEvent.click(screen.getByRole('button', { name: 'workflow.common.publish' }))

    expect(state.handleTrigger).toHaveBeenCalledTimes(1)
  })

  it('should pass loading-disabled state to the publish button', () => {
    const state = createHookState()
    state.disabled = true
    state.publishLoading = true
    mockUseAppPublisher.mockReturnValue(state)

    render(<AppPublisher />)

    expect(screen.getByRole('button', { name: /workflow\.common\.publish/i })).toBeDisabled()
  })

  it('should render access control when requested and wire the overlay callbacks', () => {
    const state = createHookState()
    state.embeddingModalOpen = true
    state.showAppAccessControl = true
    mockUseAppPublisher.mockReturnValue(state)

    render(<AppPublisher />)

    expect(screen.getByTestId('embedded-modal')).toHaveAttribute('data-open', 'true')
    expect(screen.getByTestId('access-control')).toBeInTheDocument()

    fireEvent.click(screen.getByText('close-embedded'))
    fireEvent.click(screen.getByText('confirm-access'))
    fireEvent.click(screen.getByText('close-access'))

    expect(state.closeEmbeddingModal).toHaveBeenCalledTimes(1)
    expect(state.handleAccessControlUpdate).toHaveBeenCalledTimes(1)
    expect(state.closeAppAccessControl).toHaveBeenCalledTimes(1)
  })

  it('should skip rendering access control when the app detail is absent', () => {
    const state = createHookState()
    state.appDetail = undefined
    state.showAppAccessControl = true
    mockUseAppPublisher.mockReturnValue(state)

    render(<AppPublisher />)

    expect(screen.queryByTestId('access-control')).not.toBeInTheDocument()
  })
})
