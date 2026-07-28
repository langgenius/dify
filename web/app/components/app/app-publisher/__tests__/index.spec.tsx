/* oxlint-disable typescript/no-explicit-any */
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { WorkflowContext } from '@/app/components/workflow/context'
import { AccessMode } from '@/models/access-control'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { AppModeEnum } from '@/types/app'
import { basePath } from '@/utils/var'
import { AppPublisher } from '../index'

const render = (ui: React.ReactElement) =>
  renderWithConsoleQuery(ui, {
    systemFeatures: { webapp_auth: { enabled: true } },
  })

const mockOnPublish = vi.fn()
const mockOnToggle = vi.fn()
const mockSetAppDetail = vi.fn()
const mockTrackEvent = vi.fn()
const mockRefetch = vi.fn()
const mockUseGetUserCanAccessApp = vi.fn()
const mockFetchAppDetail = vi.fn()
const mockToastError = vi.fn()
const mockToastSuccess = vi.fn()
const mockWindowOpen = vi.fn()
const mockInvalidateAppWorkflow = vi.fn()
const mockUpdateWorkflow = vi.fn()
const mockFetchPublishedWorkflow = vi.fn()
let mockPublishedWorkflow: Record<string, any> | null = null

const sectionProps = vi.hoisted(() => ({
  summary: null as null | Record<string, any>,
  access: null as null | Record<string, any>,
  actions: null as null | Record<string, any>,
}))
const hotkeyMocks = vi.hoisted(() => ({
  hotkeys: [] as string[],
  handlers: [] as Array<(event: { preventDefault: () => void }) => void>,
}))
const collaborationMocks = vi.hoisted(() => ({
  handler: undefined as
    | ((update: {
        type: 'app_publish_update'
        userId: string
        data: Record<string, unknown>
        timestamp: number
      }) => void)
    | undefined,
}))

let mockAppDetail: Record<string, any> | null = null
let mockWorkspacePermissionKeys: string[] = ['tool.manage']
let mockIsCurrentWorkspaceEditor = true

vi.mock('@tanstack/react-hotkeys', () => ({
  useHotkey: (hotkey: string, handler: (event: { preventDefault: () => void }) => void) => {
    hotkeyMocks.hotkeys.push(hotkey)
    hotkeyMocks.handlers.push(handler)
  },
}))

vi.mock('@/app/components/app/store', () => ({
  useStore: (
    selector: (state: {
      appDetail: Record<string, any> | null
      setAppDetail: typeof mockSetAppDetail
    }) => unknown,
  ) =>
    selector({
      appDetail: mockAppDetail,
      setAppDetail: mockSetAppDetail,
    }),
}))

vi.mock('@/hooks/use-format-time-from-now', () => ({
  useFormatTimeFromNow: () => ({
    formatTimeFromNow: () => 'moments ago',
  }),
}))

vi.mock('@/service/access-control/use-app-access-control', () => ({
  useGetUserCanAccessApp: (params: unknown) => {
    mockUseGetUserCanAccessApp(params)
    return {
      data: { result: true },
      isLoading: false,
      refetch: mockRefetch,
    }
  },
  useAppWhiteListSubjects: () => ({
    data: { groups: [], members: [] },
    isLoading: false,
  }),
}))

const mockPublishToCreatorsPlatform = vi.fn()

vi.mock('@/service/apps', () => ({
  fetchAppDetail: (...args: unknown[]) => mockFetchAppDetail(...args),
  publishToCreatorsPlatform: (...args: unknown[]) => mockPublishToCreatorsPlatform(...args),
}))

vi.mock('@/service/use-workflow', () => ({
  appWorkflowQueryOptions: (appId: string) => ({
    queryKey: ['workflow', 'publish', appId],
    queryFn: () => mockFetchPublishedWorkflow(appId),
  }),
  useAppWorkflow: () => ({ data: mockPublishedWorkflow, isSuccess: true }),
  useInvalidateAppWorkflow: () => mockInvalidateAppWorkflow,
  useUpdateWorkflow: () => ({ mutate: mockUpdateWorkflow }),
}))

vi.mock('@/app/components/workflow/collaboration/core/collaboration-manager', () => ({
  collaborationManager: {
    onAppPublishUpdate: (handler: NonNullable<(typeof collaborationMocks)['handler']>) => {
      collaborationMocks.handler = handler
      return vi.fn()
    },
  },
}))

vi.mock('@/service/use-tools', () => ({
  useWorkflowToolDetailByAppID: () => ({
    data: undefined,
    isLoading: false,
  }),
  useInvalidateAllWorkflowTools: () => vi.fn(),
  useInvalidateWorkflowToolDetailByAppID: () => vi.fn(),
}))

vi.mock('@/context/workspace-state', async () => {
  const { createWorkspaceStateModuleMock } = await import('@/test/console/state-fixture')
  return createWorkspaceStateModuleMock(() => ({
    isCurrentWorkspaceEditor: mockIsCurrentWorkspaceEditor,
    isCurrentWorkspaceManager: true,
    workspacePermissionKeys: mockWorkspacePermissionKeys,
  }))
})
vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')
  return createPermissionStateModuleMock(() => ({
    isCurrentWorkspaceManager: true,
    workspacePermissionKeys: mockWorkspacePermissionKeys,
  }))
})

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: {
    error: (...args: unknown[]) => mockToastError(...args),
    success: (...args: unknown[]) => mockToastSuccess(...args),
  },
}))

vi.mock('@/app/components/base/amplitude', () => ({
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
}))

vi.mock('../../app-access-control', () => {
  const MockAccessControl = ({
    onConfirm,
    onClose,
  }: {
    onConfirm: () => Promise<void>
    onClose: () => void
  }) => (
    <div data-testid="access-control">
      <button onClick={() => void onConfirm()}>confirm-access-control</button>
      <button onClick={onClose}>close-access-control</button>
    </div>
  )

  return {
    default: MockAccessControl,
    AccessControl: MockAccessControl,
  }
})

vi.mock('@/app/components/tools/workflow-tool', () => ({
  WorkflowToolDrawer: ({ onHide }: { onHide: () => void }) => (
    <div data-testid="workflow-tool-drawer">
      workflow tool drawer
      <button onClick={onHide}>close-workflow-tool-drawer</button>
    </div>
  ),
}))

vi.mock('@langgenius/dify-ui/popover', () => import('@/__mocks__/base-ui-popover'))

vi.mock('../sections', () => ({
  PublisherSummarySection: (props: Record<string, any>) => {
    sectionProps.summary = props
    return (
      <div>
        <button onClick={() => void props.handlePublish()}>publisher-summary-publish</button>
        <button onClick={() => void props.handleRestore()}>publisher-summary-restore</button>
        <button onClick={props.onEditVersion}>publisher-summary-edit-version</button>
      </div>
    )
  },
  PublisherAccessSection: (props: Record<string, any>) => {
    sectionProps.access = props
    return <button onClick={props.onClick}>publisher-access-control</button>
  },
  PublisherActionsSection: (props: Record<string, any>) => {
    sectionProps.actions = props
    return (
      <div data-testid="publisher-actions">
        {props.showRunConfig && props.handleOpenRunConfig && (
          <button onClick={() => props.handleOpenRunConfig(props.appURL)}>
            publisher-run-config
          </button>
        )}
        <button onClick={props.onConfigureWorkflowTool}>publisher-workflow-tool</button>
      </div>
    )
  },
}))

describe('AppPublisher', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hotkeyMocks.hotkeys.length = 0
    hotkeyMocks.handlers.length = 0
    collaborationMocks.handler = undefined
    sectionProps.summary = null
    sectionProps.access = null
    sectionProps.actions = null
    mockPublishedWorkflow = null
    mockFetchPublishedWorkflow.mockResolvedValue(null)
    mockWorkspacePermissionKeys = ['tool.manage']
    mockIsCurrentWorkspaceEditor = true
    mockAppDetail = {
      id: 'app-1',
      name: 'Demo App',
      mode: AppModeEnum.CHAT,
      access_mode: AccessMode.SPECIFIC_GROUPS_MEMBERS,
      site: {
        app_base_url: 'https://example.com',
        access_token: 'token-1',
      },
    }
    mockFetchAppDetail.mockResolvedValue({
      id: 'app-1',
      access_mode: AccessMode.PUBLIC,
    })
    Object.defineProperty(window, 'open', {
      configurable: true,
      writable: true,
      value: mockWindowOpen,
    })
  })

  it('should enable access permission query when the publish popover opens', async () => {
    render(<AppPublisher publishedAt={Date.now()} onToggle={mockOnToggle} />)

    fireEvent.click(screen.getByText(/(?:^|\.)common\.publish(?=$|:)/))

    expect(screen.getByText('publisher-summary-publish'))!.toBeInTheDocument()
    expect(mockOnToggle).toHaveBeenCalledWith(true)

    await waitFor(() => {
      expect(mockUseGetUserCanAccessApp).toHaveBeenCalledWith({
        appId: 'app-1',
        enabled: true,
      })
    })
    expect(mockRefetch).not.toHaveBeenCalled()
  })

  it('should publish and track the publish event', async () => {
    mockOnPublish.mockResolvedValue(undefined)

    render(<AppPublisher publishedAt={Date.now()} onPublish={mockOnPublish} />)

    fireEvent.click(screen.getByText(/(?:^|\.)common\.publish(?=$|:)/))
    fireEvent.click(screen.getByText('publisher-summary-publish'))

    await waitFor(() => {
      expect(mockOnPublish).toHaveBeenCalledTimes(1)
      expect(mockTrackEvent).toHaveBeenCalledWith(
        'app_published_time',
        expect.objectContaining({
          action_mode: 'app',
          app_id: 'app-1',
          app_name: 'Demo App',
        }),
      )
    })
  })

  it('should edit the current workflow version from the publish summary', () => {
    mockAppDetail = {
      ...mockAppDetail,
      mode: AppModeEnum.WORKFLOW,
    }
    mockPublishedWorkflow = {
      created_at: Math.floor(Date.now() / 1000),
      id: 'workflow-version-5',
      marked_name: 'Release 5',
      marked_comment: 'Initial notes',
    }

    render(<AppPublisher publishedAt={Date.now()} />)

    fireEvent.click(screen.getByText(/(?:^|\.)common\.publish(?=$|:)/))
    expect(sectionProps.summary).toEqual(
      expect.objectContaining({
        isWorkflowApp: true,
        versionInfo: mockPublishedWorkflow,
      }),
    )
    fireEvent.click(screen.getByText('publisher-summary-edit-version'))

    expect(screen.queryByTestId('popover-content')).not.toBeInTheDocument()
    const [titleInput, notesInput] = screen.getAllByRole('textbox')
    fireEvent.change(titleInput!, { target: { value: 'Release 6' } })
    fireEvent.change(notesInput!, { target: { value: 'Updated notes' } })
    const publishButtons = screen.getAllByRole('button', {
      name: /(?:^|\.)common\.publish(?=$|:)/,
    })
    fireEvent.click(publishButtons.at(-1)!)

    expect(mockUpdateWorkflow).toHaveBeenCalledWith(
      {
        url: '/apps/app-1/workflows/workflow-version-5',
        title: 'Release 6',
        releaseNotes: 'Updated notes',
      },
      expect.objectContaining({
        onSuccess: expect.any(Function),
        onError: expect.any(Function),
        onSettled: expect.any(Function),
      }),
    )

    const mutationCallbacks = mockUpdateWorkflow.mock.calls[0]![1]
    mutationCallbacks.onSuccess()
    expect(mockInvalidateAppWorkflow).toHaveBeenCalledWith('app-1')
    expect(mockToastSuccess).toHaveBeenCalled()
  })

  it('should expose the Deploy quick link for editable workflow apps when enabled', () => {
    mockAppDetail = {
      ...mockAppDetail,
      mode: AppModeEnum.WORKFLOW,
    }

    renderWithConsoleQuery(<AppPublisher publishedAt={Date.now()} />, {
      systemFeatures: { webapp_auth: { enabled: true }, enable_app_deploy: true },
    })

    fireEvent.click(screen.getByText(/(?:^|\.)common\.publish(?=$|:)/))

    expect(sectionProps.actions?.showDeployAction).toBe(true)
    expect(sectionProps.actions?.appURL).toContain('/workflow/token-1')
  })

  it('should collect hidden inputs before opening the web app from its config action', async () => {
    render(
      <AppPublisher
        publishedAt={Date.now()}
        inputs={[
          {
            variable: 'secret',
            label: 'Secret',
            type: 'text-input',
            required: true,
            hide: true,
            default: '',
          } as any,
        ]}
      />,
    )

    fireEvent.click(screen.getByText(/(?:^|\.)common\.publish(?=$|:)/))

    expect(sectionProps.actions?.showRunConfig).toBe(true)
    fireEvent.click(screen.getByText('publisher-run-config'))

    expect(
      screen.getByText(/(?:^|\.)overview\.appInfo\.workflowLaunchHiddenInputs\.title(?=$|:)/),
    ).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Secret'), {
      target: { value: 'top-secret' },
    })
    fireEvent.click(
      screen.getByRole('button', { name: /(?:^|\.)overview\.appInfo\.launch(?=$|:)/ }),
    )

    await waitFor(() => {
      expect(mockWindowOpen).toHaveBeenCalledWith(
        `https://example.com${basePath}/chat/token-1?secret=${encodeURIComponent('top-secret')}`,
        '_blank',
      )
    })
  })

  it('should keep workflow tool drawer mounted after closing the publish popover', () => {
    mockAppDetail = {
      ...mockAppDetail,
      mode: AppModeEnum.WORKFLOW,
    }

    render(<AppPublisher publishedAt={Date.now()} toolPublished />)

    fireEvent.click(screen.getByText(/(?:^|\.)common\.publish(?=$|:)/))
    expect(sectionProps.actions).toEqual(
      expect.objectContaining({
        toolPublished: true,
        workflowToolOutdated: false,
      }),
    )
    fireEvent.click(screen.getByText('publisher-workflow-tool'))

    expect(screen.queryByTestId('popover-content')).not.toBeInTheDocument()
    expect(screen.getByTestId('workflow-tool-drawer')).toBeInTheDocument()
  })

  it('should not open workflow tool drawer without tool.manage', () => {
    mockWorkspacePermissionKeys = []
    mockAppDetail = {
      ...mockAppDetail,
      mode: AppModeEnum.WORKFLOW,
    }

    render(<AppPublisher publishedAt={Date.now()} />)

    fireEvent.click(screen.getByText(/(?:^|\.)common\.publish(?=$|:)/))
    fireEvent.click(screen.getByText('publisher-workflow-tool'))

    expect(screen.queryByTestId('workflow-tool-drawer')).not.toBeInTheDocument()
    expect(sectionProps.actions?.workflowToolAvailable).toBe(false)
  })

  it('should close access control through its child callback', async () => {
    render(<AppPublisher publishedAt={Date.now()} />)

    fireEvent.click(screen.getByText(/(?:^|\.)common\.publish(?=$|:)/))
    fireEvent.click(screen.getByText('publisher-access-control'))
    expect(screen.getByTestId('access-control'))!.toBeInTheDocument()
    fireEvent.click(screen.getByText('close-access-control'))
    expect(screen.queryByTestId('access-control')).not.toBeInTheDocument()
  })

  it('should refresh app detail after access control confirmation', async () => {
    const { queryClient } = render(<AppPublisher publishedAt={Date.now()} />)
    const setQueryDataSpy = vi.spyOn(queryClient, 'setQueryData')

    fireEvent.click(screen.getByText(/(?:^|\.)common\.publish(?=$|:)/))
    fireEvent.click(screen.getByText('publisher-access-control'))

    expect(screen.getByTestId('access-control'))!.toBeInTheDocument()

    fireEvent.click(screen.getByText('confirm-access-control'))

    await waitFor(() => {
      expect(mockFetchAppDetail).toHaveBeenCalledWith({ url: '/apps', id: 'app-1' })
    })
    expect(setQueryDataSpy).toHaveBeenCalledWith(
      ['apps', 'detail', 'app-1'],
      expect.objectContaining({
        access_mode: AccessMode.PUBLIC,
      }),
    )
    expect(mockSetAppDetail).toHaveBeenCalledWith(
      expect.objectContaining({
        access_mode: AccessMode.PUBLIC,
      }),
    )
  })

  it('should ignore the trigger when the publish button is disabled', () => {
    render(<AppPublisher disabled publishedAt={Date.now()} onToggle={mockOnToggle} />)

    fireEvent.click(
      screen.getByText(/(?:^|\.)common\.publish(?=$|:)/).parentElement
        ?.parentElement as HTMLElement,
    )

    expect(screen.queryByText('publisher-summary-publish')).not.toBeInTheDocument()
    expect(mockOnToggle).not.toHaveBeenCalled()
  })

  it('should publish from the keyboard shortcut and restore the popover state', async () => {
    const preventDefault = vi.fn()
    const onRestore = vi.fn().mockResolvedValue(undefined)
    mockOnPublish.mockResolvedValue(undefined)

    const { rerender } = render(
      <AppPublisher
        hasUnpublishedChanges
        publishedAt={Date.now()}
        onPublish={mockOnPublish}
        onRestore={onRestore}
      />,
    )

    expect(hotkeyMocks.hotkeys).toContain('Mod+Shift+P')
    hotkeyMocks.handlers[0]!({ preventDefault })

    await waitFor(() => {
      expect(preventDefault).toHaveBeenCalled()
      expect(mockOnPublish).toHaveBeenCalledTimes(1)
    })

    rerender(
      <AppPublisher
        hasUnpublishedChanges={false}
        publishedAt={Date.now()}
        onPublish={mockOnPublish}
        onRestore={onRestore}
      />,
    )
    hotkeyMocks.handlers.at(-1)!({ preventDefault })
    expect(mockOnPublish).toHaveBeenCalledTimes(1)

    rerender(
      <AppPublisher
        hasUnpublishedChanges
        publishedAt={Date.now()}
        onPublish={mockOnPublish}
        onRestore={onRestore}
      />,
    )
    hotkeyMocks.handlers.at(-1)!({ preventDefault })
    await waitFor(() => {
      expect(mockOnPublish).toHaveBeenCalledTimes(2)
    })

    fireEvent.click(screen.getByText(/(?:^|\.)common\.publish(?=$|:)/))
    fireEvent.click(screen.getByText('publisher-summary-restore'))

    await waitFor(() => {
      expect(onRestore).toHaveBeenCalledTimes(1)
    })
    expect(screen.queryByText('publisher-summary-publish')).not.toBeInTheDocument()
  })

  it('should require an explicit model selection when publishing in multiple model mode', () => {
    const preventDefault = vi.fn()

    render(
      <AppPublisher
        debugWithMultipleModel
        hasUnpublishedChanges
        multipleModelConfigs={[
          {
            id: 'model-1',
            model: 'gpt-4o',
            provider: 'openai',
            parameters: {},
          },
        ]}
        publishedAt={Date.now()}
        onPublish={mockOnPublish}
      />,
    )

    hotkeyMocks.handlers[0]!({ preventDefault })

    expect(preventDefault).not.toHaveBeenCalled()
    expect(mockOnPublish).not.toHaveBeenCalled()
  })

  it('should keep the popover open when restore and publish fail', async () => {
    const preventDefault = vi.fn()
    const onRestore = vi.fn().mockRejectedValue(new Error('restore failed'))
    mockOnPublish.mockRejectedValueOnce(new Error('publish failed'))

    render(
      <AppPublisher
        hasUnpublishedChanges
        publishedAt={Date.now()}
        onPublish={mockOnPublish}
        onRestore={onRestore}
      />,
    )

    hotkeyMocks.handlers[0]!({ preventDefault })

    await waitFor(() => {
      expect(preventDefault).toHaveBeenCalled()
      expect(mockOnPublish).toHaveBeenCalledTimes(1)
    })
    expect(mockTrackEvent).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText(/(?:^|\.)common\.publish(?=$|:)/))
    fireEvent.click(screen.getByText('publisher-summary-restore'))

    await waitFor(() => {
      expect(onRestore).toHaveBeenCalledTimes(1)
    })
    expect(screen.getByText('publisher-summary-publish'))!.toBeInTheDocument()
  })

  it('should show marketplace button and open redirect URL on success', async () => {
    mockPublishToCreatorsPlatform.mockResolvedValue({
      redirect_url: 'https://marketplace.example.com/publish?code=abc',
    })
    const windowOpenSpy = vi.spyOn(window, 'open').mockImplementation(() => null)

    renderWithConsoleQuery(<AppPublisher publishedAt={Date.now()} onPublish={mockOnPublish} />, {
      systemFeatures: { webapp_auth: { enabled: true }, enable_creators_platform: true },
    })

    fireEvent.click(screen.getByText(/(?:^|\.)common\.publish(?=$|:)/))
    fireEvent.click(screen.getByText(/(?:^|\.)common\.publishToMarketplace(?=$|:)/))

    await waitFor(() => {
      expect(mockPublishToCreatorsPlatform).toHaveBeenCalledWith({ appID: 'app-1' })
      expect(windowOpenSpy).toHaveBeenCalledWith(
        'https://marketplace.example.com/publish?code=abc',
        '_blank',
      )
    })

    windowOpenSpy.mockRestore()
  })

  it('should show toast error when publish to marketplace fails', async () => {
    mockPublishToCreatorsPlatform.mockRejectedValue(new Error('network error'))

    renderWithConsoleQuery(<AppPublisher publishedAt={Date.now()} onPublish={mockOnPublish} />, {
      systemFeatures: { webapp_auth: { enabled: true }, enable_creators_platform: true },
    })

    fireEvent.click(screen.getByText(/(?:^|\.)common\.publish(?=$|:)/))
    fireEvent.click(screen.getByText(/(?:^|\.)common\.publishToMarketplace(?=$|:)/))

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith(
        expect.stringMatching(/(?:^|\.)common\.publishToMarketplaceFailed(?=$|:)/),
      )
    })
  })

  it('should disable marketplace button when not yet published', () => {
    renderWithConsoleQuery(<AppPublisher onPublish={mockOnPublish} />, {
      systemFeatures: { webapp_auth: { enabled: true }, enable_creators_platform: true },
    })

    fireEvent.click(screen.getByText(/(?:^|\.)common\.publish(?=$|:)/))
    const marketplaceButton = screen
      .getByText(/(?:^|\.)common\.publishToMarketplace(?=$|:)/)
      .closest('a, button, div[role="button"]') as HTMLElement
    expect(marketplaceButton).toBeInTheDocument()
    // clicking should not call the API because publishedAt is undefined
    fireEvent.click(screen.getByText(/(?:^|\.)common\.publishToMarketplace(?=$|:)/))
    expect(mockPublishToCreatorsPlatform).not.toHaveBeenCalled()
  })

  it('should hide marketplace button when enable_creators_platform is false', () => {
    render(<AppPublisher publishedAt={Date.now()} onPublish={mockOnPublish} />)

    fireEvent.click(screen.getByText(/(?:^|\.)common\.publish(?=$|:)/))
    expect(
      screen.queryByText(/(?:^|\.)common\.publishToMarketplace(?=$|:)/),
    ).not.toBeInTheDocument()
  })

  it('should keep access control open when app detail is unavailable during confirmation', async () => {
    mockAppDetail = null

    render(<AppPublisher publishedAt={Date.now()} />)

    fireEvent.click(screen.getByText(/(?:^|\.)common\.publish(?=$|:)/))
    fireEvent.click(screen.getByText('publisher-access-control'))
    fireEvent.click(screen.getByText('confirm-access-control'))

    await waitFor(() => {
      expect(mockFetchAppDetail).not.toHaveBeenCalled()
    })
    expect(screen.getByTestId('access-control'))!.toBeInTheDocument()
  })

  it('should not infer an app mode when app detail is unavailable', async () => {
    const user = userEvent.setup()
    mockAppDetail = null

    render(<AppPublisher publishedAt={Date.now()} />)

    await user.click(screen.getByText(/(?:^|\.)common\.publish(?=$|:)/))

    expect(sectionProps.summary).toEqual(
      expect.objectContaining({
        isChatApp: false,
        isWorkflowApp: false,
      }),
    )
  })

  it('should derive workflow changes from draft and published hashes', async () => {
    const user = userEvent.setup()
    mockAppDetail = {
      ...mockAppDetail,
      mode: AppModeEnum.WORKFLOW,
    }
    mockPublishedWorkflow = {
      created_at: 1_710_000_100,
      hash: 'published-hash',
    }

    const { rerender } = render(
      <AppPublisher
        draftHash="published-hash"
        draftUpdatedAt={1_710_000_200_000}
        publishedAt={1_710_000_100_000}
      />,
    )

    await user.click(screen.getByText(/(?:^|\.)common\.publish(?=$|:)/))
    expect(sectionProps.summary?.hasUnpublishedChanges).toBe(false)

    rerender(
      <AppPublisher
        draftHash="changed-draft-hash"
        draftUpdatedAt={1_710_000_100_000}
        publishedAt={1_710_000_200_000}
      />,
    )
    expect(sectionProps.summary?.hasUnpublishedChanges).toBe(true)
  })

  it('should keep workflow publishing available when the published hash is unavailable', async () => {
    const user = userEvent.setup()
    mockAppDetail = {
      ...mockAppDetail,
      mode: AppModeEnum.WORKFLOW,
    }
    mockPublishedWorkflow = {
      created_at: 1_710_000_100,
      hash: '',
    }

    render(
      <AppPublisher
        draftHash="draft-hash"
        draftUpdatedAt={1_710_000_200_000}
        publishedAt={1_710_000_100_000}
      />,
    )

    await user.click(screen.getByText(/(?:^|\.)common\.publish(?=$|:)/))

    expect(sectionProps.summary).toEqual(
      expect.objectContaining({
        hasUnpublishedChanges: true,
        publishedAt: 1_710_000_100_000,
      }),
    )
  })

  it('should refresh the shared workflow query and store after a collaborator publishes', async () => {
    const setPublishedAt = vi.fn()
    const workflowStore = {
      getState: () => ({ setPublishedAt }),
    }
    mockAppDetail = {
      ...mockAppDetail,
      mode: AppModeEnum.WORKFLOW,
    }
    mockFetchPublishedWorkflow.mockResolvedValue({
      created_at: 1_710_000_300,
      hash: 'published-hash',
    })

    render(
      <WorkflowContext value={workflowStore as any}>
        <AppPublisher draftHash="draft-hash" publishedAt={1_710_000_100_000} />
      </WorkflowContext>,
    )

    act(() => {
      collaborationMocks.handler?.({
        type: 'app_publish_update',
        userId: 'collaborator-1',
        data: { action: 'published' },
        timestamp: 1_710_000_300_000,
      })
    })

    await waitFor(() => {
      expect(mockFetchPublishedWorkflow).toHaveBeenCalledWith('app-1')
      expect(setPublishedAt).toHaveBeenCalledWith(1_710_000_300)
    })
  })
})
