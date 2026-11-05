import type { ComponentProps } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { render } from 'vitest-browser-react'
import { CollectionType } from '@/app/components/tools/types'
import { BlockEnum } from '@/app/components/workflow/types'
import { createTestQueryClient } from '@/test/query-client'
import { TestConnectionSetup } from '..'

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.tools.builtin.get': () => [],
      'workspaces.current.toolProvider.builtin.byProvider.credential.schema.byCredentialType.get':
        () => [],
    }),
  }
})

vi.mock('@/app/components/workflow/hooks/use-workflow', () => ({
  useNodesReadOnly: () => ({ nodesReadOnly: false }),
}))

vi.mock('@/hooks/use-credential-permissions', () => ({
  useCredentialPermissions: () => ({
    canUseCredential: true,
    canCreateCredential: false,
    canManageCredential: false,
  }),
}))

vi.mock('@/app/components/plugins/plugin-auth/hooks/use-plugin-auth', () => ({
  usePluginAuth: () => ({
    isAuthorized: true,
    canOAuth: false,
    canApiKey: false,
    isLoading: false,
    notAllowCustomCredential: true,
    invalidPluginCredentialInfo: vi.fn(),
    credentials: [
      {
        id: 'workspace-key',
        name: 'Workspace key',
        credential_type: 'api-key',
        is_default: false,
      },
      {
        id: 'other-member-key',
        name: 'Other member key',
        credential_type: 'api-key',
        is_default: false,
        from_other_member: true,
      },
      {
        id: 'oauth-account',
        name: 'OAuth account',
        credential_type: 'oauth2',
        is_default: false,
      },
    ],
  }),
}))

it('keeps Studio workspace permission filtering and reports the selected credential for its node', async () => {
  const onSelect = vi.fn()
  const connections = {
    nodes: [
      {
        id: 'github-node',
        type: 'custom',
        position: { x: 0, y: 0 },
        data: {
          title: 'Search repositories',
          desc: '',
          type: BlockEnum.Tool,
          provider_id: 'langgenius/github/github',
          provider_name: 'GitHub',
          provider_type: CollectionType.builtIn,
          tool_name: 'search',
          tool_label: 'Search',
          tool_parameters: {},
          tool_configurations: {},
          end_user_auth: { allowed_credential_types: ['api-key'] },
        },
      },
    ],
    credentials: [],
    warningCount: 1,
    open: false,
    checking: false,
    error: false,
    onOpenChange: vi.fn(),
    onSelect,
    check: vi.fn().mockResolvedValue(false),
    beforeRun: vi.fn().mockResolvedValue(false),
    cancelPendingCheck: vi.fn(),
  } satisfies ComponentProps<typeof TestConnectionSetup>['connections']
  const screen = await render(
    <QueryClientProvider client={createTestQueryClient()}>
      <TestConnectionSetup connections={connections} isResponding={false} />
    </QueryClientProvider>,
  )

  const picker = screen.getByRole('button', { name: /share.connections.setup.selectConnection/ })
  await expect.element(picker).toBeEnabled()
  await picker.click()
  await expect
    .element(screen.getByRole('button', { name: /OAuth account/ }))
    .not.toBeInTheDocument()
  await expect.element(screen.getByRole('button', { name: /Other member key/ })).toBeDisabled()
  await screen.getByRole('button', { name: /Workspace key/ }).click()
  expect(onSelect).toHaveBeenCalledExactlyOnceWith('github-node', 'workspace-key')
})
