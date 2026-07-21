import type { ReactNode } from 'react'
import type { AgentProviderTool } from '@/features/agent-v2/agent-composer/form-state'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CollectionType } from '@/app/components/tools/types'
import { AgentProviderToolItem } from '../item'

// `usePluginAuth` is the surface that used to fire the failing
// `GET /workspaces/current/tool-provider/builtin/<api-id>/credential/...`
// request — see langgenius/dify#39169. The fix has two halves:
//   1. `useGetApi` now short-circuits for an explicitly-set non-builtin
//      `providerType` (the defense-in-depth, hook-level fix).
//   2. `UnauthorizedCredentialStatus` returns null before calling
//      `usePluginAuth` for non-builtin `providerType` (the render-level
//      guard, mirrored on `CredentialStatus.canSwitchCredential`).
// We mock `usePluginAuth` and assert it is NEVER called with an api-type
// provider payload, regardless of `credentialVariant`.

const mockUsePluginAuth = vi.fn()

vi.mock('@/app/components/plugins/plugin-auth/hooks/use-plugin-auth', () => ({
  usePluginAuth: (...args: unknown[]) => mockUsePluginAuth(...args),
}))

// The `Authorized` component reaches into `@/service/use-plugins-auth` and
// `@/service/use-tools` for mutations / invalidations. None of those
// mutations ever fire in this test (we never open the popover), but they
// still get evaluated and need a `QueryClient` to render at all — without
// the mocks below we get a `No QueryClient set` error from react-query.
vi.mock('@/service/use-plugins-auth', () => ({
  useGetPluginCredentialInfo: (url: string) => ({
    data: url ? { supported_credential_types: [], credentials: [] } : undefined,
    isLoading: false,
  }),
  useDeletePluginCredential: () => ({ mutateAsync: vi.fn() }),
  useSetPluginDefaultCredential: () => ({ mutateAsync: vi.fn() }),
  useUpdatePluginCredential: () => ({ mutateAsync: vi.fn() }),
  useInvalidPluginCredentialInfo: () => vi.fn(),
  useGetPluginOAuthUrl: () => ({ mutateAsync: vi.fn() }),
  useGetPluginOAuthClientSchema: () => ({ data: undefined, isLoading: false }),
  useSetPluginOAuthCustomClient: () => ({ mutateAsync: vi.fn() }),
  useDeletePluginOAuthCustomClient: () => ({ mutateAsync: vi.fn() }),
  useInvalidPluginOAuthClientSchema: () => vi.fn(),
  useAddPluginCredential: () => ({ mutateAsync: vi.fn() }),
  useGetPluginCredentialSchema: () => ({ data: undefined, isLoading: false }),
}))

vi.mock('@/service/use-tools', () => ({
  useInvalidToolsByType: () => vi.fn(),
}))

// `read-only-context` gates the credential controls behind a permission
// switch; we want it to be writable here so the unauthorized branch is
// actually reached.
vi.mock('../../../read-only-context', () => ({
  useAgentOrchestrateReadOnly: () => false,
}))

// `useTheme` would otherwise need a ThemeProvider ancestor.
vi.mock('@/hooks/use-theme', () => ({
  default: () => ({ theme: 'light' }),
}))

const baseTool = (overrides: Partial<AgentProviderTool> = {}): AgentProviderTool => ({
  kind: 'provider',
  id: '730b5917-e9c5-43ae-9985-962361bc39fd',
  name: '<custom-api-tool-provider>',
  iconClassName: 'i-custom',
  actions: [],
  credentialVariant: 'unauthorized',
  ...overrides,
})

const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  })

const wrapper = ({ children }: { children: ReactNode }) => {
  const testQueryClient = createTestQueryClient()
  return <QueryClientProvider client={testQueryClient}>{children}</QueryClientProvider>
}

const renderItem = (tool: AgentProviderTool) =>
  render(
    <AgentProviderToolItem
      tool={tool}
      isExpanded={false}
      onOpenChange={vi.fn()}
      onConfigureAction={vi.fn()}
      onRemoveAction={vi.fn()}
      onRemoveProvider={vi.fn()}
      onCredentialChange={vi.fn()}
    />,
    { wrapper },
  )

describe('AgentProviderToolItem credential status (#39169)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUsePluginAuth.mockReturnValue({
      isAuthorized: false,
      canOAuth: false,
      canApiKey: false,
      credentials: [],
      invalidPluginCredentialInfo: vi.fn(),
      notAllowCustomCredential: false,
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('does not call usePluginAuth for an api-type unauthorized tool', () => {
    // Pre-fix this fired `usePluginAuth({ provider: <api-row-uuid>,
    // category: 'tool', providerType: 'api' }, true)` and the api
    // container 500'd because that id is not a builtin provider id.
    renderItem(baseTool({ providerType: CollectionType.custom }))

    expect(mockUsePluginAuth).not.toHaveBeenCalled()
    // No "not authorized" status button should appear for an api-type
    // tool — its credentials live on the tool_api_providers row and there
    // is no plugin-auth UI to open.
    expect(screen.queryByRole('button', { name: /notAuthorized/i })).not.toBeInTheDocument()
  })

  it('does not call usePluginAuth for an api-type authorized tool either', () => {
    // The same parent-level gate must apply to the `authorized` branch
    // too: `CredentialStatus` short-circuits before reaching
    // `AuthorizedInNode` for non-builtin providerType, so no plugin-auth
    // query ever fires regardless of `credentialVariant`.
    renderItem(
      baseTool({
        providerType: CollectionType.custom,
        credentialVariant: 'authorized',
        credentialId: 'some-cred-id',
      }),
    )

    expect(mockUsePluginAuth).not.toHaveBeenCalled()
  })

  it('does not call usePluginAuth for any non-builtin providerType', () => {
    // mcp/workflow/model/etc. providers do not use the plugin credential
    // model either. Pin the contract so a future refactor can't
    // accidentally re-introduce the same 500 for another providerType.
    const nonBuiltins: Array<CollectionType | string> = [
      CollectionType.custom,
      CollectionType.mcp,
      CollectionType.workflow,
      CollectionType.model,
    ]

    for (const providerType of nonBuiltins) {
      mockUsePluginAuth.mockClear()
      renderItem(baseTool({ providerType }))
      expect(mockUsePluginAuth, `providerType=${providerType}`).not.toHaveBeenCalled()
      cleanup()
    }
  })

  it('still calls usePluginAuth for an unauthorized builtin tool', () => {
    // Sanity check: the render-level guard must NOT regress legitimate
    // builtin tools. We render the popover-trigger button rather than the
    // popover body itself because it requires user interaction to open.
    renderItem(baseTool({ providerType: CollectionType.builtIn }))

    expect(mockUsePluginAuth).toHaveBeenCalledTimes(1)
    const call = mockUsePluginAuth.mock.calls[0]
    const [pluginPayload, enable] = call as [
      { provider: string; category: string; providerType?: string },
      boolean,
    ]
    expect(pluginPayload).toMatchObject({
      provider: '730b5917-e9c5-43ae-9985-962361bc39fd',
      category: 'tool',
      providerType: CollectionType.builtIn,
    })
    expect(enable).toBe(true)
    expect(screen.getByRole('button', { name: /notAuthorized/i })).toBeInTheDocument()
  })
})
