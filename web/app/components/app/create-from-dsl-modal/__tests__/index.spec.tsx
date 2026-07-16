/* oxlint-disable typescript/no-explicit-any */
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithSystemFeatures as render } from '@/__tests__/utils/mock-system-features'
import { NEED_REFRESH_APP_LIST_KEY } from '@/app/components/apps/storage'
import { DSLImportMode, DSLImportStatus } from '@/models/app'
import { AppModeEnum } from '@/types/app'
import CreateFromDSLModal from '../index'
import { CreateFromDSLModalTab } from '../types'

const mockPush = vi.fn()
const mockImportDSL = vi.fn()
const mockImportDSLConfirm = vi.fn()
const mockTrackCreateApp = vi.fn()
const mockHandleCheckPluginDependencies = vi.fn()
const mockGetRedirection = vi.fn()
const mockResolveImportedAppRedirectionTarget = vi.fn(
  async (target: Record<string, unknown>) => target,
)
const mockInvalidateAppList = vi.hoisted(() => vi.fn())
const toastMocks = vi.hoisted(() => ({
  call: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
}))
const hotkeyMocks = vi.hoisted(() => ({
  handlers: new Map<string, { handler: () => void; options?: { enabled?: boolean } }>(),
}))
let mockPlanUsage = 0
let mockPlanTotal = 10
let mockWorkspacePermissionKeys: string[] = ['app.create_and_management']
const mockUserProfile = { id: 'user-1' }
vi.mock('ahooks', () => ({
  useDebounceFn: (fn: (...args: any[]) => any) => ({
    run: fn,
  }),
}))

vi.mock('@tanstack/react-hotkeys', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-hotkeys')>()
  return {
    ...actual,
    useHotkey: (hotkey: string, handler: () => void, options?: { enabled?: boolean }) => {
      hotkeyMocks.handlers.set(hotkey, { handler, options })
    },
  }
})

const triggerHotkey = (hotkey: string) => {
  const registration = hotkeyMocks.handlers.get(hotkey)
  if (registration?.options?.enabled === false) return
  registration?.handler()
}

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}))

vi.mock('@/utils/create-app-tracking', () => ({
  trackCreateApp: (...args: unknown[]) => mockTrackCreateApp(...args),
}))

vi.mock('@/service/apps', () => ({
  importDSL: (...args: unknown[]) => mockImportDSL(...args),
  importDSLConfirm: (...args: unknown[]) => mockImportDSLConfirm(...args),
}))
vi.mock('@/service/use-apps', () => ({
  useInvalidateAppList: () => mockInvalidateAppList,
}))

vi.mock('@/app/components/workflow/plugin-dependency/hooks', () => ({
  usePluginDependencies: () => ({
    handleCheckPluginDependencies: mockHandleCheckPluginDependencies,
  }),
}))

vi.mock('@/context/account-state', async (importOriginal) => {
  const { createAppContextStateAtomMock } = await import('@/__tests__/utils/mock-app-context-state')

  return createAppContextStateAtomMock(importOriginal, () => ({
    userProfile: mockUserProfile,
    workspacePermissionKeys: mockWorkspacePermissionKeys,
  }))
})
vi.mock('@/context/workspace-state', async (importOriginal) => {
  const { createAppContextStateAtomMock } = await import('@/__tests__/utils/mock-app-context-state')

  return createAppContextStateAtomMock(importOriginal, () => ({
    userProfile: mockUserProfile,
    workspacePermissionKeys: mockWorkspacePermissionKeys,
  }))
})
vi.mock('@/context/permission-state', async (importOriginal) => {
  const { createAppContextStateAtomMock } = await import('@/__tests__/utils/mock-app-context-state')

  return createAppContextStateAtomMock(importOriginal, () => ({
    userProfile: mockUserProfile,
    workspacePermissionKeys: mockWorkspacePermissionKeys,
  }))
})
vi.mock('@/context/version-state', async (importOriginal) => {
  const { createAppContextStateAtomMock } = await import('@/__tests__/utils/mock-app-context-state')

  return createAppContextStateAtomMock(importOriginal, () => ({
    userProfile: mockUserProfile,
    workspacePermissionKeys: mockWorkspacePermissionKeys,
  }))
})
vi.mock('@/context/system-features-state', async (importOriginal) => {
  const { createAppContextStateAtomMock } = await import('@/__tests__/utils/mock-app-context-state')

  return createAppContextStateAtomMock(importOriginal, () => ({
    userProfile: mockUserProfile,
    workspacePermissionKeys: mockWorkspacePermissionKeys,
  }))
})

vi.mock('jotai', async (importOriginal) => {
  const { createAppContextStateJotaiMock } =
    await import('@/__tests__/utils/mock-app-context-state')

  return createAppContextStateJotaiMock(importOriginal)
})

vi.mock('@/context/provider-context', () => ({
  useProviderContext: () => ({
    plan: {
      usage: {
        buildApps: mockPlanUsage,
      },
      total: {
        buildApps: mockPlanTotal,
      },
    },
    enableBilling: true,
  }),
}))

vi.mock('@/utils/app-redirection', () => ({
  getRedirection: (...args: unknown[]) => mockGetRedirection(...args),
}))

vi.mock('@/utils/imported-app-redirection', () => ({
  resolveImportedAppRedirectionTarget: (target: Record<string, unknown>) =>
    mockResolveImportedAppRedirectionTarget(target),
}))

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: Object.assign((...args: unknown[]) => toastMocks.call(...args), {
    success: (...args: unknown[]) => toastMocks.success(...args),
    error: (...args: unknown[]) => toastMocks.error(...args),
    warning: (...args: unknown[]) => toastMocks.warning(...args),
  }),
}))

vi.mock('@/app/components/billing/apps-full-in-dialog', () => ({
  default: () => <div>apps-full</div>,
}))

describe('CreateFromDSLModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hotkeyMocks.handlers.clear()
    mockPlanUsage = 0
    mockPlanTotal = 10
    mockWorkspacePermissionKeys = ['app.create_and_management']
    localStorage.clear()

    class MockFileReader {
      result = 'app: demo'
      onload: ((event: { target: { result: string } }) => void) | null = null
      readAsText() {
        this.onload?.({ target: { result: this.result } })
      }
    }

    // @ts-expect-error test-only file reader shim
    globalThis.FileReader = MockFileReader
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const getCreateButton = () => screen.getByRole('button', { name: /newApp\.Create/i })

  it('should render the file tab and show the dropped file', async () => {
    render(
      <CreateFromDSLModal
        show
        onClose={vi.fn()}
        droppedFile={new File(['app: demo'], 'demo.yml', { type: 'text/yaml' })}
      />,
    )

    expect(screen.getByText(/(?:^|\.)importApp(?=$|:)/))!.toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByText(/(?:^|\.)demo\.yml(?=$|:)/))!.toBeInTheDocument()
    })
  })

  it('should switch tabs, close from the header icon, and ignore shortcuts without valid input', async () => {
    const handleClose = vi.fn()
    render(<CreateFromDSLModal show onClose={handleClose} />)

    triggerHotkey('Mod+Enter')
    expect(mockImportDSL).not.toHaveBeenCalled()

    await act(async () => {
      fireEvent.click(screen.getByText(/(?:^|\.)importFromDSLUrl(?=$|:)/))
    })
    expect(
      screen.getByPlaceholderText(/(?:^|\.)importFromDSLUrlPlaceholder(?=$|:)/),
    )!.toBeInTheDocument()

    const closeTrigger = screen
      .getByText(/(?:^|\.)importApp(?=$|:)/)
      .parentElement?.querySelector('.cursor-pointer.items-center') as HTMLElement
    fireEvent.click(closeTrigger)
    expect(handleClose).toHaveBeenCalledTimes(1)
  })

  it('should render the import shortcut with kbd primitives', () => {
    render(
      <CreateFromDSLModal
        show
        onClose={vi.fn()}
        activeTab={CreateFromDSLModalTab.FROM_URL}
        dslUrl="https://example.com/app.yml"
      />,
    )

    const createButton = getCreateButton()
    expect(createButton.querySelectorAll('kbd')).toHaveLength(2)
  })

  it('should import from a URL and redirect after a successful import', async () => {
    const handleClose = vi.fn()
    const handleSuccess = vi.fn()
    mockImportDSL.mockResolvedValue({
      id: 'import-1',
      status: DSLImportStatus.COMPLETED,
      app_id: 'app-1',
      app_mode: AppModeEnum.CHAT,
      permission_keys: ['app.acl.view_layout'],
    })

    render(
      <CreateFromDSLModal
        show
        onClose={handleClose}
        onSuccess={handleSuccess}
        activeTab={CreateFromDSLModalTab.FROM_URL}
      />,
    )

    fireEvent.change(screen.getByPlaceholderText(/(?:^|\.)importFromDSLUrlPlaceholder(?=$|:)/), {
      target: { value: 'https://example.com/app.yml' },
    })

    await act(async () => {
      fireEvent.click(getCreateButton())
    })

    expect(mockImportDSL).toHaveBeenCalledWith({
      mode: DSLImportMode.YAML_URL,
      yaml_url: 'https://example.com/app.yml',
    })
    expect(mockTrackCreateApp).toHaveBeenCalledWith({
      source: 'studio_upload',
      appMode: AppModeEnum.CHAT,
    })
    expect(handleSuccess).toHaveBeenCalledTimes(1)
    expect(handleClose).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem(NEED_REFRESH_APP_LIST_KEY)).toBe('1')
    expect(mockInvalidateAppList).toHaveBeenCalledTimes(1)
    expect(mockHandleCheckPluginDependencies).toHaveBeenCalledWith('app-1')
    expect(mockGetRedirection).toHaveBeenCalledWith(
      { id: 'app-1', mode: 'chat', permission_keys: ['app.acl.view_layout'] },
      mockPush,
      {
        currentUserId: 'user-1',
        resourceMaintainer: 'user-1',
        workspacePermissionKeys: ['app.create_and_management'],
        isRbacEnabled: false,
      },
    )
  })

  it('should pass creator context when import response has no permission keys', async () => {
    mockImportDSL.mockResolvedValue({
      id: 'import-no-permissions',
      status: DSLImportStatus.COMPLETED,
      app_id: 'app-no-permissions',
      app_mode: AppModeEnum.WORKFLOW,
    })

    render(
      <CreateFromDSLModal
        show
        onClose={vi.fn()}
        activeTab={CreateFromDSLModalTab.FROM_URL}
        dslUrl="https://example.com/app.yml"
      />,
    )

    await act(async () => {
      fireEvent.click(getCreateButton())
    })

    expect(mockGetRedirection).toHaveBeenCalledWith(
      { id: 'app-no-permissions', mode: AppModeEnum.WORKFLOW, permission_keys: undefined },
      mockPush,
      {
        currentUserId: 'user-1',
        resourceMaintainer: 'user-1',
        workspacePermissionKeys: ['app.create_and_management'],
        isRbacEnabled: false,
      },
    )
  })

  it('should import from a file with the loaded file content', async () => {
    mockImportDSL.mockResolvedValue({
      id: 'import-2',
      status: DSLImportStatus.COMPLETED_WITH_WARNINGS,
      app_id: 'app-2',
      app_mode: AppModeEnum.AGENT,
      permission_keys: ['app.acl.view_layout'],
      warnings: [
        {
          code: 'agent_secret_required',
          path: 'agent_packages.agent_1.soul.env.secret_refs',
          message: "Agent secret 'SEARCH_TOKEN' must be configured.",
          details: { name: 'SEARCH_TOKEN' },
        },
      ],
    })

    render(
      <CreateFromDSLModal
        show
        onClose={vi.fn()}
        droppedFile={new File(['app: demo'], 'demo.yml', { type: 'text/yaml' })}
      />,
    )

    await waitFor(() => {
      expect(screen.getByText(/(?:^|\.)demo\.yml(?=$|:)/))!.toBeInTheDocument()
    })

    await act(async () => {
      fireEvent.click(getCreateButton())
    })

    expect(mockImportDSL).toHaveBeenCalledWith({
      mode: DSLImportMode.YAML_CONTENT,
      yaml_content: 'app: demo',
    })
    expect(toastMocks.call).toHaveBeenCalledWith(
      expect.stringMatching(/(?:^|\.)newApp\.caution(?=$|:)/),
      {
        type: 'warning',
        description: "Agent secret 'SEARCH_TOKEN' must be configured.",
      },
    )
  })

  it('should remove the current file and keep the create shortcut guarded', async () => {
    render(
      <CreateFromDSLModal
        show
        onClose={vi.fn()}
        droppedFile={new File(['app: demo'], 'demo.yml', { type: 'text/yaml' })}
      />,
    )

    await waitFor(() => {
      expect(screen.getByText(/(?:^|\.)demo\.yml(?=$|:)/))!.toBeInTheDocument()
    })

    const removeButton = screen
      .getByText(/(?:^|\.)demo\.yml(?=$|:)/)
      .closest('.group')
      ?.querySelector('button') as HTMLButtonElement
    await act(async () => {
      fireEvent.click(removeButton)
    })

    await waitFor(() => {
      expect(screen.queryByText(/(?:^|\.)demo\.yml(?=$|:)/)).not.toBeInTheDocument()
      expect(getCreateButton())!.toBeDisabled()
    })

    triggerHotkey('Mod+Enter')
    expect(mockImportDSL).not.toHaveBeenCalled()
  })

  it('should show the DSL mismatch modal and confirm a pending import', async () => {
    vi.useFakeTimers()
    mockImportDSL.mockResolvedValue({
      id: 'import-3',
      status: DSLImportStatus.PENDING,
      imported_dsl_version: '1.0.0',
      current_dsl_version: '2.0.0',
    })
    mockImportDSLConfirm.mockResolvedValue({
      status: DSLImportStatus.COMPLETED,
      app_id: 'app-3',
      app_mode: AppModeEnum.WORKFLOW,
      permission_keys: ['app.acl.view_layout'],
    })

    render(
      <CreateFromDSLModal
        show
        onClose={vi.fn()}
        onSuccess={vi.fn()}
        activeTab={CreateFromDSLModalTab.FROM_URL}
        dslUrl="https://example.com/app.yml"
      />,
    )

    await act(async () => {
      fireEvent.click(getCreateButton())
    })

    await act(async () => {
      vi.advanceTimersByTime(300)
    })

    expect(
      screen.getAllByText(/(?:^|\.)newApp\.appCreateDSLErrorTitle(?=$|:)/)[0],
    )!.toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: /(?:^|\.)newApp\.Confirm(?=$|:)/ })[0]!)
    })

    expect(mockImportDSLConfirm).toHaveBeenCalledWith({
      import_id: 'import-3',
    })
    expect(mockInvalidateAppList).toHaveBeenCalledTimes(1)
    expect(mockTrackCreateApp).toHaveBeenCalledWith({
      source: 'studio_upload',
      appMode: AppModeEnum.WORKFLOW,
    })
    expect(mockGetRedirection).toHaveBeenCalledWith(
      { id: 'app-3', mode: AppModeEnum.WORKFLOW, permission_keys: ['app.acl.view_layout'] },
      mockPush,
      {
        currentUserId: 'user-1',
        resourceMaintainer: 'user-1',
        workspacePermissionKeys: ['app.create_and_management'],
        isRbacEnabled: false,
      },
    )
  })

  it('should surface Agent warnings after confirming a pending import', async () => {
    vi.useFakeTimers()
    mockImportDSL.mockResolvedValue({
      id: 'agent-import-pending',
      status: DSLImportStatus.PENDING,
      imported_dsl_version: '1.0.0',
      current_dsl_version: '2.0.0',
    })
    mockImportDSLConfirm.mockResolvedValue({
      status: DSLImportStatus.COMPLETED_WITH_WARNINGS,
      app_id: 'agent-app-1',
      app_mode: AppModeEnum.AGENT,
      warnings: [
        {
          code: 'agent_tool_authorization_required',
          path: 'agent_packages.agent_1.soul.tools.dify_tools.0',
          message: "Agent tool 'web_search' requires authorization.",
          details: { tool_name: 'web_search' },
        },
      ],
    })
    mockResolveImportedAppRedirectionTarget.mockResolvedValueOnce({
      id: 'agent-app-1',
      mode: AppModeEnum.AGENT,
      permission_keys: undefined,
      bound_agent_id: 'agent-1',
    })

    render(
      <CreateFromDSLModal
        show
        onClose={vi.fn()}
        activeTab={CreateFromDSLModalTab.FROM_URL}
        dslUrl="https://example.com/agent.yml"
      />,
    )

    await act(async () => {
      fireEvent.click(getCreateButton())
    })
    await act(async () => {
      vi.advanceTimersByTime(300)
    })
    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: /newApp\.Confirm/ })[0]!)
    })

    expect(toastMocks.call).toHaveBeenCalledWith(expect.stringMatching(/newApp\.caution/), {
      type: 'warning',
      description: "Agent tool 'web_search' requires authorization.",
    })
    expect(mockResolveImportedAppRedirectionTarget).toHaveBeenCalledWith({
      id: 'agent-app-1',
      mode: AppModeEnum.AGENT,
      permission_keys: undefined,
    })
    expect(mockGetRedirection).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'agent-app-1',
        mode: AppModeEnum.AGENT,
        bound_agent_id: 'agent-1',
      }),
      mockPush,
      expect.any(Object),
    )
  })

  it('should close the DSL mismatch modal when dialog requests close', async () => {
    vi.useFakeTimers()
    mockImportDSL.mockResolvedValue({
      id: 'import-close',
      status: DSLImportStatus.PENDING,
      imported_dsl_version: '1.0.0',
      current_dsl_version: '2.0.0',
    })

    render(
      <CreateFromDSLModal
        show
        onClose={vi.fn()}
        activeTab={CreateFromDSLModalTab.FROM_URL}
        dslUrl="https://example.com/app.yml"
      />,
    )

    await act(async () => {
      fireEvent.click(getCreateButton())
    })

    await act(async () => {
      vi.advanceTimersByTime(300)
    })

    expect(screen.getByText(/(?:^|\.)newApp\.appCreateDSLErrorTitle(?=$|:)/))!.toBeInTheDocument()

    vi.useRealTimers()
    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' })

    await waitFor(() => {
      expect(
        screen.queryByText(/(?:^|\.)newApp\.appCreateDSLErrorTitle(?=$|:)/),
      ).not.toBeInTheDocument()
    })
  })

  it('should close the DSL mismatch modal when cancel is clicked', async () => {
    vi.useFakeTimers()
    mockImportDSL.mockResolvedValue({
      id: 'import-cancel',
      status: DSLImportStatus.PENDING,
      imported_dsl_version: '1.0.0',
      current_dsl_version: '2.0.0',
    })

    render(
      <CreateFromDSLModal
        show
        onClose={vi.fn()}
        activeTab={CreateFromDSLModalTab.FROM_URL}
        dslUrl="https://example.com/app.yml"
      />,
    )

    await act(async () => {
      fireEvent.click(getCreateButton())
    })

    await act(async () => {
      vi.advanceTimersByTime(300)
    })

    expect(screen.getByText(/(?:^|\.)newApp\.appCreateDSLErrorTitle(?=$|:)/))!.toBeInTheDocument()

    vi.useRealTimers()
    fireEvent.click(
      screen.getAllByRole('button', { name: /(?:^|\.)newApp\.Cancel(?=$|:)/ }).at(-1)!,
    )

    await waitFor(() => {
      expect(
        screen.queryByText(/(?:^|\.)newApp\.appCreateDSLErrorTitle(?=$|:)/),
      ).not.toBeInTheDocument()
    })
  })

  it('should ignore empty import responses and prevent duplicate submissions while a request is in flight', async () => {
    let resolveImport!: (value: {
      id: string
      status: DSLImportStatus
      app_id: string
      app_mode: string
      permission_keys?: string[]
    }) => void
    mockImportDSL.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveImport = resolve as typeof resolveImport
        }),
    )

    render(
      <CreateFromDSLModal
        show
        onClose={vi.fn()}
        activeTab={CreateFromDSLModalTab.FROM_URL}
        dslUrl="https://example.com/app.yml"
      />,
    )

    fireEvent.click(getCreateButton())
    fireEvent.click(getCreateButton())

    expect(mockImportDSL).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveImport({
        id: 'import-in-flight',
        status: DSLImportStatus.COMPLETED,
        app_id: 'app-1',
        app_mode: AppModeEnum.CHAT,
        permission_keys: ['app.acl.view_layout'],
      })
    })

    mockImportDSL.mockResolvedValueOnce(undefined)

    await act(async () => {
      fireEvent.click(getCreateButton())
    })

    expect(mockImportDSL).toHaveBeenCalledTimes(2)
    expect(toastMocks.error).not.toHaveBeenCalled()
  })

  it('should handle keyboard shortcut and quota guard', async () => {
    const handleClose = vi.fn()
    mockImportDSL.mockResolvedValue({
      id: 'import-shortcut',
      status: DSLImportStatus.COMPLETED,
      app_id: 'app-shortcut',
      app_mode: 'chat',
      permission_keys: ['app.acl.view_layout'],
    })

    render(
      <CreateFromDSLModal
        show
        onClose={handleClose}
        activeTab={CreateFromDSLModalTab.FROM_URL}
        dslUrl="https://example.com/app.yml"
      />,
    )

    triggerHotkey('Mod+Enter')

    await waitFor(() => {
      expect(mockImportDSL).toHaveBeenCalledWith({
        mode: DSLImportMode.YAML_URL,
        yaml_url: 'https://example.com/app.yml',
      })
    })

    mockPlanUsage = 1
    mockPlanTotal = 1
    render(
      <CreateFromDSLModal
        show
        onClose={vi.fn()}
        activeTab={CreateFromDSLModalTab.FROM_URL}
        dslUrl="https://example.com/app.yml"
      />,
    )

    expect(screen.getByText('apps-full'))!.toBeInTheDocument()
    triggerHotkey('Mod+Enter')
    expect(mockImportDSL).toHaveBeenCalledTimes(1)
  })

  it('should show failure toasts for failed and rejected imports', async () => {
    mockImportDSL.mockResolvedValueOnce({
      id: 'import-failed',
      status: DSLImportStatus.FAILED,
      error: 'Invalid YAML format',
    })
    mockImportDSL.mockRejectedValueOnce(new Error('boom'))

    const { rerender } = render(
      <CreateFromDSLModal
        show
        onClose={vi.fn()}
        activeTab={CreateFromDSLModalTab.FROM_URL}
        dslUrl="https://example.com/app.yml"
      />,
    )

    await act(async () => {
      fireEvent.click(getCreateButton())
    })
    expect(toastMocks.error).toHaveBeenCalledWith('Invalid YAML format')

    rerender(
      <CreateFromDSLModal
        show
        onClose={vi.fn()}
        activeTab={CreateFromDSLModalTab.FROM_URL}
        dslUrl="https://example.com/app.yml"
      />,
    )

    await act(async () => {
      fireEvent.click(getCreateButton())
    })
    expect(toastMocks.error).toHaveBeenCalledTimes(2)
    expect(toastMocks.error).toHaveBeenLastCalledWith(
      expect.stringMatching(/(?:^|\.)newApp\.appCreateFailed(?=$|:)/),
    )
  })

  it('should handle pending import confirmation failures and cancellation', async () => {
    vi.useFakeTimers()
    mockImportDSL.mockResolvedValue({
      id: 'import-4',
      status: DSLImportStatus.PENDING,
      imported_dsl_version: '1.0.0',
      current_dsl_version: '2.0.0',
    })
    mockImportDSLConfirm
      .mockResolvedValueOnce({
        status: DSLImportStatus.FAILED,
        error: 'Confirm failed',
      })
      .mockRejectedValueOnce(new Error('boom'))

    render(
      <CreateFromDSLModal
        show
        onClose={vi.fn()}
        activeTab={CreateFromDSLModalTab.FROM_URL}
        dslUrl="https://example.com/app.yml"
      />,
    )

    await act(async () => {
      fireEvent.click(getCreateButton())
      vi.advanceTimersByTime(300)
    })

    fireEvent.click(
      screen.getAllByRole('button', { name: /(?:^|\.)newApp\.Cancel(?=$|:)/ }).at(-1)!,
    )
    expect(
      screen.queryByText(/(?:^|\.)newApp\.appCreateDSLErrorTitle(?=$|:)/),
    ).not.toBeInTheDocument()

    await act(async () => {
      fireEvent.click(getCreateButton())
      vi.advanceTimersByTime(300)
    })
    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: /(?:^|\.)newApp\.Confirm(?=$|:)/ })[0]!)
    })
    expect(toastMocks.error).toHaveBeenCalledWith('Confirm failed')

    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: /(?:^|\.)newApp\.Confirm(?=$|:)/ })[0]!)
    })
    expect(toastMocks.error).toHaveBeenCalledTimes(2)
    expect(toastMocks.error).toHaveBeenLastCalledWith(
      expect.stringMatching(/(?:^|\.)newApp\.appCreateFailed(?=$|:)/),
    )
  })
})
