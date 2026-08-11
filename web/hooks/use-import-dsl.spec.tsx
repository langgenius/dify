import { act, waitFor } from '@testing-library/react'
import { DSLImportMode, DSLImportStatus } from '@/models/app'
import { renderHookWithConsoleQuery } from '@/test/console/query-data'
import { AppModeEnum } from '@/types/app'
import { useImportDSL } from './use-import-dsl'

const mockPush = vi.hoisted(() => vi.fn())
const mockImportDSL = vi.hoisted(() => vi.fn())
const mockImportDSLConfirm = vi.hoisted(() => vi.fn())
const mockHandleCheckPluginDependencies = vi.hoisted(() => vi.fn())
const mockGetRedirection = vi.hoisted(() => vi.fn())
const mockResolveImportedAppRedirectionTarget = vi.hoisted(() => vi.fn())
const toastMocks = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
  warning: vi.fn(),
}))

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: toastMocks,
}))

vi.mock('@/app/components/workflow/plugin-dependency/hooks', () => ({
  usePluginDependencies: () => ({
    handleCheckPluginDependencies: mockHandleCheckPluginDependencies,
  }),
}))

vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')

  return createPermissionStateModuleMock(() => ({
    workspacePermissionKeys: ['app.create_and_management'],
  }))
})

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

vi.mock('@/service/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/client')>()

  return {
    ...actual,
    consoleQuery: {
      ...actual.consoleQuery,
      account: {
        profile: {
          get: {
            queryKey: () => [['console', 'account', 'profile', 'get'], { type: 'query' }],
          },
        },
      },
      systemFeatures: actual.consoleQuery.systemFeatures,
      apps: {
        ...actual.consoleQuery.apps,
        imports: {
          ...actual.consoleQuery.apps.imports,
          post: {
            mutationOptions: () => ({
              mutationFn: ({ body }: { body: Record<string, unknown> }) => mockImportDSL(body),
            }),
          },
          byImportId: {
            confirm: {
              post: {
                mutationOptions: () => ({
                  mutationFn: ({ params }: { params: { import_id: string } }) =>
                    mockImportDSLConfirm({ import_id: params.import_id }),
                }),
              },
            },
          },
        },
      },
    },
  }
})

vi.mock('@/utils/app-redirection', () => ({
  getRedirection: (...args: unknown[]) => mockGetRedirection(...args),
}))

vi.mock('@/utils/imported-app-redirection', () => ({
  resolveImportedAppRedirectionTarget: (...args: unknown[]) =>
    mockResolveImportedAppRedirectionTarget(...args),
}))

describe('useImportDSL', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockResolveImportedAppRedirectionTarget.mockImplementation(async (target) => target)
  })

  it('should complete a confirmed import that returns warnings', async () => {
    let resolvePluginCheck: (() => void) | undefined
    const pendingResponse = {
      id: 'import-1',
      status: DSLImportStatus.PENDING,
      app_mode: AppModeEnum.AGENT,
      imported_dsl_version: '0.2.0',
      current_dsl_version: '0.1.0',
      permission_keys: [],
    }
    const completedResponse = {
      id: 'import-1',
      status: DSLImportStatus.COMPLETED_WITH_WARNINGS,
      app_id: 'app-1',
      app_mode: AppModeEnum.AGENT,
      permission_keys: ['app.acl.view_layout'],
      warnings: [
        {
          code: 'agent_file_omitted',
          path: 'agent.omitted_assets',
          message: 'Agent file was not included.',
          details: {},
        },
      ],
    }
    const onPending = vi.fn()
    const onSuccess = vi.fn()
    const onFailed = vi.fn()
    mockImportDSL.mockResolvedValue(pendingResponse)
    mockImportDSLConfirm.mockResolvedValue(completedResponse)
    mockHandleCheckPluginDependencies.mockReturnValue(
      new Promise<void>((resolve) => {
        resolvePluginCheck = resolve
      }),
    )

    const { result } = renderHookWithConsoleQuery(() => useImportDSL())

    await act(async () => {
      await result.current.handleImportDSL(
        {
          mode: DSLImportMode.YAML_CONTENT,
          yaml_content: 'app: demo',
        },
        { onPending },
      )
    })
    let confirmPromise: Promise<void> | undefined
    act(() => {
      confirmPromise = result.current.handleImportDSLConfirm({ onSuccess, onFailed })
    })
    await waitFor(() => {
      expect(mockHandleCheckPluginDependencies).toHaveBeenCalledWith('app-1')
    })
    expect(result.current.isFetching).toBe(true)

    await act(async () => {
      await result.current.handleImportDSLConfirm({ onSuccess, onFailed })
    })
    expect(mockImportDSLConfirm).toHaveBeenCalledTimes(1)

    resolvePluginCheck?.()
    await act(async () => {
      await confirmPromise
    })

    expect(mockImportDSLConfirm).toHaveBeenCalledWith({ import_id: 'import-1' })
    expect(onSuccess).toHaveBeenCalledWith(completedResponse)
    expect(onFailed).not.toHaveBeenCalled()
    expect(toastMocks.warning).toHaveBeenCalledWith('app.newApp.caution', {
      description: 'app.newApp.appCreateDSLWarning',
    })
    expect(mockHandleCheckPluginDependencies).toHaveBeenCalledWith('app-1')
    expect(mockResolveImportedAppRedirectionTarget).toHaveBeenCalledWith({
      id: 'app-1',
      mode: AppModeEnum.AGENT,
      permission_keys: ['app.acl.view_layout'],
    })
    expect(mockGetRedirection).toHaveBeenCalledTimes(1)
    expect(result.current.isFetching).toBe(false)
  })
})
