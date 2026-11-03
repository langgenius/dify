import type { Import } from '@dify/contracts/api/console/apps/types.gen'
import type { consoleClient } from '@/service/console'
import {
  zGetAppsByAppIdResponse,
  zPostAppsImportsResponse,
} from '@dify/contracts/api/console/apps/zod.gen'
import { act, render, screen, waitFor } from '@testing-library/react'
import { DSLImportMode, DSLImportStatus } from '@/models/app'
import { httpErrorFromResponse } from '@/service/http-error'
import { renderHookWithConsoleQuery } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { createAppDetailFixture } from '@/test/fixtures/app'
import { useImportDSL } from './use-import-dsl'

const mockPush = vi.hoisted(() => vi.fn())
const mockImportDSL = vi.hoisted(() => vi.fn<typeof consoleClient.apps.imports.post>())
const mockImportDSLConfirm = vi.hoisted(() =>
  vi.fn<typeof consoleClient.apps.imports.byImportId.confirm.post>(),
)
const checkDependencies = vi.hoisted(() =>
  vi.fn<typeof consoleClient.apps.imports.byAppId.checkDependencies.get>(),
)
const getImportedApp = vi.hoisted(() => vi.fn<typeof consoleClient.apps.byAppId.get>())
const createImport = (overrides: Partial<Import> = {}) =>
  zPostAppsImportsResponse.parse({
    id: 'import-1',
    status: DSLImportStatus.PENDING,
    ...overrides,
  })
const renderImport = () =>
  renderHookWithConsoleQuery(useImportDSL, {
    workspacePermissionKeys: ['app.create_and_management'],
    systemFeatures: { rbac_enabled: true },
  })
const toastMocks = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
  warning: vi.fn(),
}))

vi.mock('@/app/notifications', () => ({
  toast: toastMocks,
}))

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses, withConsoleClientResponses } =
    await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'apps.byAppId.get': getImportedApp,
    }),
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'apps.imports.post': mockImportDSL,
      'apps.imports.byImportId.confirm.post': mockImportDSLConfirm,
      'apps.imports.byAppId.checkDependencies.get': checkDependencies,
    }),
  }
})

describe('useImportDSL', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockImportDSL.mockReset()
    mockImportDSLConfirm.mockReset()
    checkDependencies.mockReset().mockResolvedValue({ leaked_dependencies: [] })
    getImportedApp
      .mockReset()
      .mockResolvedValue(
        zGetAppsByAppIdResponse.parse(
          createAppDetailFixture({ mode: 'agent', bound_agent_id: 'agent-1' }),
        ),
      )
  })

  it('should preserve nullable app metadata in the import request', async () => {
    mockImportDSL.mockResolvedValue(createImport())
    const payload = {
      mode: DSLImportMode.YAML_CONTENT,
      yaml_content: 'app: demo',
      name: 'Imported app',
      icon_type: null,
      icon: null,
      icon_background: null,
      description: null,
    }
    const onPending = vi.fn()
    const { result } = renderImport()

    await act(async () => {
      await result.current.handleImportDSL(payload, { onPending })
    })

    expect(mockImportDSL).toHaveBeenCalledWith({ body: payload })
    expect(onPending).toHaveBeenCalledWith(createImport())
  })

  it('should show response warnings when an import completes with warnings', async () => {
    const completedResponse = createImport({
      id: 'import-1',
      status: DSLImportStatus.COMPLETED_WITH_WARNINGS,
      app_id: 'app-1',
      app_mode: 'workflow',
      permission_keys: [],
      warnings: [
        {
          code: 'agent_tool_authorization_required',
          path: 'agent_packages.agent_1.soul.tools.dify_tools.0',
          message: "Agent tool 'jina_search' requires authorization.",
          details: { tool_name: 'jina_search' },
        },
      ],
    })
    mockImportDSL.mockResolvedValue(completedResponse)

    const { result } = renderImport()

    await act(async () => {
      await result.current.handleImportDSL(
        {
          mode: DSLImportMode.YAML_CONTENT,
          yaml_content: 'app: demo',
        },
        { skipRedirectOnSuccess: true },
      )
    })

    expect(toastMocks.warning).toHaveBeenCalledWith('app.newApp.caution', {
      description: expect.anything(),
    })
    const warningDescription = toastMocks.warning.mock.calls[0]![1].description
    render(<>{warningDescription}</>)
    expect(screen.getByText("Agent tool 'jina_search' requires authorization.")).toBeInTheDocument()
    expect(screen.queryByText('app.newApp.appCreateDSLWarning')).not.toBeInTheDocument()
    expect(checkDependencies).toHaveBeenCalledWith({ params: { app_id: 'app-1' } })
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('should complete a confirmed import that returns warnings', async () => {
    const pluginCheck =
      createDeferred<
        Awaited<ReturnType<typeof consoleClient.apps.imports.byAppId.checkDependencies.get>>
      >()
    const pendingResponse = createImport({
      id: 'import-1',
      status: DSLImportStatus.PENDING,
      app_mode: 'agent',
      imported_dsl_version: '0.2.0',
      current_dsl_version: '0.1.0',
      permission_keys: [],
    })
    const completedResponse = createImport({
      id: 'import-1',
      status: DSLImportStatus.COMPLETED_WITH_WARNINGS,
      app_id: 'app-1',
      app_mode: 'agent',
      permission_keys: ['app.acl.view_layout'],
      warnings: [
        {
          code: 'agent_file_omitted',
          path: 'agent.omitted_assets',
          message: 'Agent file was not included.',
          details: {},
        },
      ],
    })
    const onPending = vi.fn()
    const onSuccess = vi.fn()
    const onFailed = vi.fn()
    mockImportDSL.mockResolvedValue(pendingResponse)
    mockImportDSLConfirm.mockResolvedValue(completedResponse)
    checkDependencies.mockReturnValue(pluginCheck.promise)

    const { result } = renderImport()

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
      expect(checkDependencies).toHaveBeenCalledWith({ params: { app_id: 'app-1' } })
    })
    expect(result.current.isFetching).toBe(true)
    expect(getImportedApp).not.toHaveBeenCalled()
    expect(mockPush).not.toHaveBeenCalled()

    await act(async () => {
      await result.current.handleImportDSLConfirm({ onSuccess, onFailed })
    })
    expect(mockImportDSLConfirm).toHaveBeenCalledTimes(1)

    await act(async () => {
      pluginCheck.resolve({ leaked_dependencies: [] })
      await confirmPromise
    })

    expect(mockImportDSLConfirm).toHaveBeenCalledWith({ params: { import_id: 'import-1' } })
    expect(onSuccess).toHaveBeenCalledWith(completedResponse)
    expect(onFailed).not.toHaveBeenCalled()
    expect(toastMocks.warning).toHaveBeenCalledWith('app.newApp.caution', {
      description: expect.anything(),
    })
    const warningDescription = toastMocks.warning.mock.calls[0]![1].description
    render(<>{warningDescription}</>)
    expect(screen.getByText('Agent file was not included.')).toBeInTheDocument()
    expect(screen.queryByText('app.newApp.appCreateDSLWarning')).not.toBeInTheDocument()
    expect(checkDependencies).toHaveBeenCalledWith({ params: { app_id: 'app-1' } })
    expect(getImportedApp).toHaveBeenCalledWith({ params: { app_id: 'app-1' } })
    expect(mockPush).toHaveBeenCalledExactlyOnceWith('/agents/agent-1/configure')
    expect(result.current.isFetching).toBe(false)
  })

  it('should toast the backend error when import status is failed', async () => {
    const importError =
      'Missing app data in YAML content. ' +
      "Not a valid Dify app DSL: the top-level 'app' section is required (found: meta)."
    mockImportDSL.mockResolvedValue(
      createImport({
        id: 'import-failed',
        status: DSLImportStatus.FAILED,
        error: importError,
      }),
    )
    const onFailed = vi.fn()
    const { result } = renderImport()

    await act(async () => {
      await result.current.handleImportDSL(
        {
          mode: DSLImportMode.YAML_CONTENT,
          yaml_content: 'meta: {}\n',
        },
        { onFailed },
      )
    })

    expect(toastMocks.error).toHaveBeenCalledExactlyOnceWith('app.newApp.appCreateFailed', {
      description: importError,
    })
    expect(onFailed).toHaveBeenCalled()
  })

  it.each([
    [
      'JSON',
      () => Response.json({ message: 'Missing app section' }, { status: 400 }),
      'Missing app section',
    ],
    ['empty', () => new Response(null, { status: 500 }), 'HTTP 500'],
    ['HTML', () => new Response('<html>Bad gateway</html>', { status: 502 }), 'HTTP 502'],
    ['network', () => new Error('network'), 'network'],
  ] as const)('shows one failure toast for a %s import error', async (_, response, description) => {
    const error = response()
    mockImportDSL.mockRejectedValue(
      error instanceof Response ? await httpErrorFromResponse(error) : error,
    )
    const onFailed = vi.fn()
    const { result } = renderImport()

    await act(async () => {
      await result.current.handleImportDSL(
        {
          mode: DSLImportMode.YAML_CONTENT,
          yaml_content: 'meta: {}\n',
        },
        { onFailed },
      )
    })

    expect(toastMocks.error).toHaveBeenCalledExactlyOnceWith('app.newApp.appCreateFailed', {
      description,
    })
    expect(onFailed).toHaveBeenCalled()
  })

  it.each([undefined, 'Import confirmation expired'])(
    'shows one error when a confirmed import fails (%s)',
    async (importError) => {
      mockImportDSL.mockResolvedValue(createImport())
      mockImportDSLConfirm.mockResolvedValue(
        createImport({
          id: 'import-1',
          status: DSLImportStatus.FAILED,
          error: importError,
        }),
      )
      const onFailed = vi.fn()
      const { result } = renderImport()

      await act(async () => {
        await result.current.handleImportDSL(
          {
            mode: DSLImportMode.YAML_CONTENT,
            yaml_content: 'app: demo',
          },
          {},
        )
      })
      await act(async () => {
        await result.current.handleImportDSLConfirm({ onFailed })
      })

      expect(toastMocks.error).toHaveBeenCalledExactlyOnceWith('app.newApp.appCreateFailed', {
        description: importError,
      })
      expect(onFailed).toHaveBeenCalled()
    },
  )

  it('shows the backend error when confirmation rejects with an HTTP response', async () => {
    mockImportDSL.mockResolvedValue(createImport())
    mockImportDSLConfirm.mockRejectedValue(
      await httpErrorFromResponse(
        Response.json({ error: 'Import confirmation expired' }, { status: 400 }),
      ),
    )
    const onFailed = vi.fn()
    const { result } = renderImport()

    await act(async () => {
      await result.current.handleImportDSL(
        { mode: DSLImportMode.YAML_CONTENT, yaml_content: 'app: demo' },
        {},
      )
      await result.current.handleImportDSLConfirm({ onFailed })
    })

    expect(toastMocks.error).toHaveBeenCalledExactlyOnceWith('app.newApp.appCreateFailed', {
      description: 'Import confirmation expired',
    })
    expect(onFailed).toHaveBeenCalledExactlyOnceWith()
    expect(result.current.isFetching).toBe(false)
  })
})
