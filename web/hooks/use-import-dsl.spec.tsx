import { act } from '@testing-library/react'
import { DSLImportMode, DSLImportStatus } from '@/models/app'
import { renderHookWithConsoleQuery } from '@/test/console/query-data'
import { AppModeEnum } from '@/types/app'
import { useImportDSL } from './use-import-dsl'

const mockPush = vi.hoisted(() => vi.fn())
const mockImportDSL = vi.hoisted(() => vi.fn())
const mockImportDSLConfirm = vi.hoisted(() => vi.fn())
const mockHandleCheckPluginDependencies = vi.hoisted(() => vi.fn())
const mockInvalidateAppList = vi.hoisted(() => vi.fn())
const mockSetNeedRefresh = vi.hoisted(() => vi.fn())
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

vi.mock('@/app/components/apps/storage', () => ({
  useSetNeedRefreshAppList: () => mockSetNeedRefresh,
}))

vi.mock('@/app/components/workflow/plugin-dependency/hooks', () => ({
  usePluginDependencies: () => ({
    handleCheckPluginDependencies: mockHandleCheckPluginDependencies,
  }),
}))

vi.mock('@/context/account-state', async () => {
  const { createAccountStateModuleMock } = await import('@/test/console/state-fixture')

  return createAccountStateModuleMock(() => ({
    userProfile: { id: 'user-1' },
  }))
})

vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')

  return createPermissionStateModuleMock(() => ({
    workspacePermissionKeys: ['app.create_and_management'],
  }))
})

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

vi.mock('@/service/apps', () => ({
  importDSL: (...args: unknown[]) => mockImportDSL(...args),
  importDSLConfirm: (...args: unknown[]) => mockImportDSLConfirm(...args),
}))

vi.mock('@/service/use-apps', () => ({
  useInvalidateAppList: () => mockInvalidateAppList,
}))

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
    await act(async () => {
      await result.current.handleImportDSLConfirm({ onSuccess, onFailed })
    })

    expect(mockImportDSLConfirm).toHaveBeenCalledWith({ import_id: 'import-1' })
    expect(onSuccess).toHaveBeenCalledWith(completedResponse)
    expect(onFailed).not.toHaveBeenCalled()
    expect(toastMocks.warning).toHaveBeenCalledWith('app.newApp.caution', {
      description: 'app.newApp.appCreateDSLWarning',
    })
    expect(mockHandleCheckPluginDependencies).toHaveBeenCalledWith('app-1')
    expect(mockSetNeedRefresh).toHaveBeenCalledWith('1')
    expect(mockInvalidateAppList).toHaveBeenCalledTimes(1)
    expect(mockResolveImportedAppRedirectionTarget).toHaveBeenCalledWith({
      id: 'app-1',
      mode: AppModeEnum.AGENT,
      permission_keys: ['app.acl.view_layout'],
    })
    expect(mockGetRedirection).toHaveBeenCalledTimes(1)
  })
})
