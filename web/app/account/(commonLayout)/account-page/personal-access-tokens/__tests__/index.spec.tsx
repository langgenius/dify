import type { PersonalAccessTokenResponse } from '@dify/contracts/api/console/account/types.gen'
import { ORPCError } from '@orpc/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import copy from 'copy-to-clipboard'
import { consoleQuery } from '@/service/console'
import { renderWithNuqs as render } from '@/test/nuqs-testing'
import { createTestQueryClient } from '@/test/query-client'
import PersonalAccessTokens from '../index'
import ResourcePicker from '../resource-picker'

const transport = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('@/service/console/browser', () => ({ consoleBrowserLink: transport }))
vi.mock('copy-to-clipboard', () => ({ default: vi.fn().mockResolvedValue(true) }))
vi.mock('@/context/i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/context/i18n')>()),
  useDocLink: () => (path?: string) => `https://docs.dify.ai/en${path ?? ''}`,
}))

const token: PersonalAccessTokenResponse = {
  id: '019a0000-0000-7000-8000-000000000001',
  name: 'release-pipeline',
  secret_last_four: '7f21',
  created_at: '2026-10-15T00:00:00Z',
  expires_at: null,
  last_used_at: null,
  resource_scope_mode: 'selected',
  workspace_scope_mode: 'selected',
  resource_count: 3,
  workspace_count: 2,
  unavailable_count: 1,
  status: 'access_issue',
  version: 1,
}

it('retries secret retrieval without creating a second token and clears the dialog session on close', async () => {
  const user = userEvent.setup()
  let secretAttempts = 0
  transport.call.mockImplementation(async (path: string[]) => {
    if (path.includes('secret')) {
      secretAttempts += 1
      if (secretAttempts === 1) throw new Error('Key unavailable')
      return { secret: 'dpat_retried_secret' }
    }
    if (path.at(-1) === 'post') return token
    return { data: [], page: 1, limit: 20, total: 0, has_more: false }
  })
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <PersonalAccessTokens />
    </QueryClientProvider>,
  )
  await user.click(
    screen.getByRole('button', { name: 'accountSettings.personalAccessToken.createButton' }),
  )
  let dialog = await screen.findByRole('dialog')
  await user.type(
    within(dialog).getByRole('textbox', { name: 'accountSettings.resourceAccessToken.name' }),
    'retry',
  )
  await user.click(within(dialog).getByRole('button', { name: 'common.operation.create' }))
  expect(await within(dialog).findByRole('alert')).toHaveTextContent(
    'accountSettings.personalAccessToken.secretUnavailable',
  )
  expect(
    transport.call.mock.calls.find(([path]) => path.includes('secret'))?.[2].context.silent,
  ).toBe(true)
  await user.click(within(dialog).getByRole('button', { name: 'common.operation.retry' }))
  expect(await within(dialog).findByDisplayValue('dpat_retried_secret')).toBeInTheDocument()
  expect(
    within(dialog).getByText('accountSettings.personalAccessToken.copyNow'),
  ).toBeInTheDocument()
  const usageLink = within(dialog).getByRole('link', {
    name: 'accountSettings.personalAccessToken.howToUseIt',
  })
  expect(usageLink).toHaveAttribute(
    'href',
    expect.stringContaining('/api-reference/guides/get-started'),
  )
  expect(usageLink).toHaveAttribute('target', '_blank')
  expect(usageLink).toHaveAttribute('rel', 'noopener noreferrer')
  expect(
    transport.call.mock.calls.filter(
      ([path]) => path.at(-1) === 'post' && !path.includes('secret'),
    ),
  ).toHaveLength(1)
  await user.click(
    within(dialog).getByRole('button', { name: 'accountSettings.resourceAccessToken.done' }),
  )
  await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  await user.click(
    screen.getByRole('button', { name: 'accountSettings.personalAccessToken.createButton' }),
  )
  dialog = await screen.findByRole('dialog')
  expect(
    within(dialog).getByRole('textbox', { name: 'accountSettings.resourceAccessToken.name' }),
  ).toHaveValue('')
  expect(within(dialog).queryByDisplayValue('dpat_retried_secret')).not.toBeInTheDocument()
})

it('retrieves the same full token for clipboard copy after remounting the list', async () => {
  const user = userEvent.setup()
  transport.call.mockImplementation(async (path: string[]) =>
    path.includes('secret')
      ? { secret: 'dpat_existing_secret' }
      : { data: [token], page: 1, limit: 20, total: 1, has_more: false },
  )
  const first = render(
    <QueryClientProvider client={createTestQueryClient()}>
      <PersonalAccessTokens />
    </QueryClientProvider>,
  )
  await user.click(await screen.findByRole('button', { name: 'common.operation.copy' }))
  await vi.waitFor(() => expect(copy).toHaveBeenCalledWith('dpat_existing_secret'))
  first.unmount()
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <PersonalAccessTokens />
    </QueryClientProvider>,
  )
  await user.click(await screen.findByRole('button', { name: 'common.operation.copy' }))
  await vi.waitFor(() => expect(copy).toHaveBeenCalledTimes(2))
  expect(screen.queryByDisplayValue('dpat_existing_secret')).not.toBeInTheDocument()
})

it('duplicates an expired token configuration while excluding unavailable selections', async () => {
  const user = userEvent.setup()
  const old = { ...token, status: 'expired', workspace_scope_mode: 'selected' }
  const allowed = {
    resource_id: '019a0000-0000-7000-8000-000000000002',
    resource_type: 'app',
    display_name: 'Available app',
    workspace_id: '019a0000-0000-7000-8000-000000000003',
    workspace_name: 'Production',
    available: true,
    reason: null,
  }
  const allowedWorkspace = {
    workspace_id: '019a0000-0000-7000-8000-000000000005',
    display_name: 'Allowed workspace',
    available: true,
    reason: null,
    role: 'owner',
  }
  transport.call.mockImplementation(async (path: string[]) => {
    if (path.includes('secret')) return { secret: 'dpat_new_secret' }
    if (path.includes('byTokenId'))
      return {
        token: old,
        resources: [
          allowed,
          {
            ...allowed,
            resource_id: '019a0000-0000-7000-8000-000000000004',
            available: false,
            reason: 'access_removed',
          },
        ],
        workspaces: [
          allowedWorkspace,
          {
            ...allowedWorkspace,
            workspace_id: '019a0000-0000-7000-8000-000000000006',
            available: false,
          },
        ],
      }
    if (path.at(-1) === 'post') return token
    if (path.includes('personalAccessTokenResources'))
      return { data: [allowed], next_cursor: null, has_more: false }
    return { data: [old], page: 1, limit: 20, total: 1, has_more: false }
  })
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <PersonalAccessTokens />
    </QueryClientProvider>,
  )
  expect(await screen.findByRole('button', { name: 'common.operation.edit' })).toBeDisabled()
  await user.click(screen.getByRole('button', { name: 'common.operation.duplicate' }))
  const dialog = await screen.findByRole('dialog')
  expect(await within(dialog).findByDisplayValue('release-pipeline')).toBeInTheDocument()
  expect(
    within(dialog).getByText(
      'accountSettings.personalAccessToken.excludedAccess:{"items":"accountSettings.personalAccessToken.resourcesCount:{\\"count\\":1} and accountSettings.personalAccessToken.workspacesCount:{\\"count\\":1}"}',
    ),
  ).toBeInTheDocument()
  await user.click(within(dialog).getByRole('button', { name: 'common.operation.create' }))
  expect(await screen.findByDisplayValue('dpat_new_secret')).toBeInTheDocument()
  const createCall = transport.call.mock.calls.find(
    ([path]) => path.at(-1) === 'post' && !path.includes('secret'),
  )
  expect(createCall?.[1].body.resource_scope.resources).toEqual([
    { resource_id: allowed.resource_id, resource_type: 'app' },
  ])
  expect(
    transport.call.mock.calls.some(([path]) => ['patch', 'delete'].includes(path.at(-1))),
  ).toBe(false)
})

it('keeps deletion pending until confirmed and refreshes the list after revocation', async () => {
  const user = userEvent.setup()
  let revoked = false
  transport.call.mockImplementation(async (path: string[]) => {
    if (path.at(-1) === 'delete') {
      revoked = true
      return undefined
    }
    return {
      data: revoked ? [] : [token],
      page: 1,
      limit: 20,
      total: revoked ? 0 : 1,
      has_more: false,
    }
  })
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <PersonalAccessTokens />
    </QueryClientProvider>,
  )
  await user.click(await screen.findByRole('button', { name: 'common.operation.delete' }))
  const dialog = await screen.findByRole('alertdialog')
  expect(revoked).toBe(false)
  await user.click(within(dialog).getByRole('button', { name: 'common.operation.delete' }))
  expect(
    await screen.findByText('accountSettings.personalAccessToken.noTokens'),
  ).toBeInTheDocument()
  expect(revoked).toBe(true)
})

it('edits saved scopes without changing expiry and submits the loaded version', async () => {
  const user = userEvent.setup()
  transport.call.mockImplementation(async (path: string[]) => {
    if (path.includes('byTokenId'))
      return {
        token: { ...token, resource_scope_mode: 'all', workspace_scope_mode: 'all' },
        resources: [],
        workspaces: [],
      }
    return { data: [token], page: 1, limit: 20, total: 1, has_more: false }
  })
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <PersonalAccessTokens />
    </QueryClientProvider>,
  )
  await user.click(await screen.findByRole('button', { name: 'common.operation.edit' }))
  const dialog = await screen.findByRole('dialog')
  const name = await within(dialog).findByRole('textbox', {
    name: 'accountSettings.resourceAccessToken.name',
  })
  await user.clear(name)
  await user.type(name, 'renamed')
  expect(within(dialog).queryByRole('combobox')).not.toBeInTheDocument()
  await user.click(within(dialog).getByRole('button', { name: 'common.operation.save' }))
  await vi.waitFor(() =>
    expect(transport.call.mock.calls.some(([path]) => path.at(-1) === 'patch')).toBe(true),
  )
  const updateCall = transport.call.mock.calls.find(([path]) => path.at(-1) === 'patch')
  expect(updateCall?.[1]).toEqual({
    params: { token_id: token.id },
    body: {
      name: 'renamed',
      version: 1,
      resource_scope: { mode: 'all', resources: [] },
      workspace_scope: { mode: 'all', workspace_ids: [] },
    },
  })
})

it('allows selecting resources and workspaces together while preventing both scopes being disabled', async () => {
  const user = userEvent.setup()
  const workspace = {
    workspace_id: '019a0000-0000-7000-8000-000000000003',
    display_name: 'Production',
    available: true,
    reason: null,
    role: 'owner',
  }
  transport.call.mockImplementation(async (path: string[]) => {
    if (path.includes('personalAccessTokenWorkspaces'))
      return { data: [workspace], next_cursor: null, has_more: false }
    if (path.includes('personalAccessTokenResources'))
      return {
        data: [
          {
            resource_id: '019a0000-0000-7000-8000-000000000004',
            resource_type: 'app',
            display_name: 'Support assistant',
            workspace_id: workspace.workspace_id,
            workspace_name: workspace.display_name,
            available: true,
            reason: null,
          },
        ],
        next_cursor: null,
        has_more: false,
      }
    if (path.includes('secret')) return { secret: 'dpat_test_complete_secret_7f21' }
    if (path.at(-1) === 'post') return token
    return { data: [], page: 1, limit: 20, total: 0, has_more: false }
  })
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <PersonalAccessTokens />
    </QueryClientProvider>,
  )
  await user.click(
    screen.getByRole('button', { name: 'accountSettings.personalAccessToken.createButton' }),
  )
  const dialog = await screen.findByRole('dialog')
  await user.type(
    within(dialog).getByRole('textbox', { name: 'accountSettings.resourceAccessToken.name' }),
    'workspace',
  )
  await user.click(
    within(dialog).getByRole('combobox', {
      name: 'accountSettings.personalAccessToken.expiration',
    }),
  )
  await user.click(
    await screen.findByRole('option', {
      name: 'accountSettings.personalAccessToken.days:{"count":365}',
    }),
  )
  const resources = within(dialog).getByRole('radiogroup', {
    name: 'accountSettings.resourceAccessToken.resources',
  })
  const workspaces = within(dialog).getByRole('radiogroup', {
    name: 'accountSettings.personalAccessToken.manageWorkspaces',
  })
  await user.click(
    within(resources).getByRole('radio', { name: 'accountSettings.personalAccessToken.none' }),
  )
  await user.click(
    within(workspaces).getByRole('radio', { name: 'accountSettings.personalAccessToken.none' }),
  )
  expect(within(dialog).getByRole('button', { name: 'common.operation.create' })).toBeDisabled()
  await user.click(
    within(workspaces).getByRole('radio', { name: 'accountSettings.personalAccessToken.selected' }),
  )
  expect(within(dialog).getByRole('button', { name: 'common.operation.create' })).toBeDisabled()
  await user.click(await within(dialog).findByRole('checkbox', { name: 'Production' }))
  await user.click(
    within(resources).getByRole('radio', { name: 'accountSettings.personalAccessToken.selected' }),
  )
  expect(within(dialog).getByRole('button', { name: 'common.operation.create' })).toBeDisabled()
  await user.click(
    await within(dialog).findByRole('checkbox', {
      name: 'dataset.metadata.datasetMetadata.builtIn',
    }),
  )
  const editCollapsedScope = () =>
    within(dialog).getByRole('button', { name: /common\.operation\.selectCount/ })
  expect(within(dialog).queryByRole('checkbox', { name: 'Production' })).not.toBeInTheDocument()
  await user.click(editCollapsedScope())
  expect(within(dialog).getByRole('checkbox', { name: 'Production' })).toBeChecked()
  expect(
    within(dialog).queryByRole('checkbox', { name: 'dataset.metadata.datasetMetadata.builtIn' }),
  ).not.toBeInTheDocument()
  await user.click(editCollapsedScope())
  expect(
    within(dialog).getByRole('checkbox', { name: 'dataset.metadata.datasetMetadata.builtIn' }),
  ).toBeChecked()
  expect(within(dialog).queryByRole('checkbox', { name: 'Production' })).not.toBeInTheDocument()
  await user.click(
    within(workspaces).getByRole('radio', { name: 'accountSettings.personalAccessToken.none' }),
  )
  expect(
    within(dialog).queryByRole('checkbox', {
      name: 'dataset.metadata.datasetMetadata.builtIn',
    }),
  ).not.toBeInTheDocument()
  expect(editCollapsedScope()).toHaveTextContent('common.operation.selectCount')
  await user.click(
    within(workspaces).getByRole('radio', { name: 'accountSettings.personalAccessToken.selected' }),
  )
  await user.click(editCollapsedScope())
  expect(
    within(dialog).getByRole('checkbox', {
      name: 'dataset.metadata.datasetMetadata.builtIn',
    }),
  ).toBeChecked()
  await user.click(within(dialog).getByRole('button', { name: 'common.operation.create' }))
  expect(await screen.findByDisplayValue('dpat_test_complete_secret_7f21')).toBeInTheDocument()
  const createCall = transport.call.mock.calls.find(
    ([path]) => path.at(-1) === 'post' && !path.includes('secret'),
  )
  expect(createCall?.[1].body.workspace_scope).toEqual({
    mode: 'selected',
    workspace_ids: [workspace.workspace_id],
  })
  expect(createCall?.[1].body.resource_scope).toEqual({
    mode: 'selected',
    resources: [{ resource_id: '019a0000-0000-7000-8000-000000000004', resource_type: 'app' }],
  })
  expect(createCall?.[1].body.expiration).toBe('365_days')
})

it('shows saved scope counts and unavailable access without exposing the full token', async () => {
  transport.call.mockResolvedValue({ data: [token], page: 1, limit: 20, total: 1, has_more: false })
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <PersonalAccessTokens />
    </QueryClientProvider>,
  )
  const table = await screen.findByRole('table')
  expect(within(table).getByRole('button', { name: 'release-pipeline' })).toBeInTheDocument()
  expect(within(table).getByText('••••7f21')).toBeInTheDocument()
  expect(
    within(table).getByText('accountSettings.personalAccessToken.resourcesCount:{"count":3}'),
  ).toBeInTheDocument()
  expect(
    within(table).getByText('accountSettings.personalAccessToken.workspacesCount:{"count":2}'),
  ).toBeInTheDocument()
  expect(
    within(table).getByText('accountSettings.personalAccessToken.unavailableCount:{"count":1}'),
  ).toBeInTheDocument()
})

it('shows a standalone empty state when there are no personal access tokens', async () => {
  transport.call.mockResolvedValue({ data: [], page: 1, limit: 20, total: 0, has_more: false })
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <PersonalAccessTokens />
    </QueryClientProvider>,
  )
  expect(
    await screen.findByText('accountSettings.personalAccessToken.noTokens'),
  ).toBeInTheDocument()
  expect(screen.queryByRole('table')).not.toBeInTheDocument()
})

it('shows the resource empty state when no accessible resources exist', async () => {
  transport.call.mockResolvedValue({ data: [], next_cursor: null, has_more: false })
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <ResourcePicker selected={[]} onToggle={vi.fn()} />
    </QueryClientProvider>,
  )
  expect(
    await screen.findByText('accountSettings.resourceAccessToken.noResourcesAvailable'),
  ).toBeInTheDocument()
  expect(
    screen.getByText('accountSettings.resourceAccessToken.resourcesWillAppearHere'),
  ).toBeInTheDocument()
})

it('preserves selected resources while candidates are loading and after a load failure', async () => {
  const user = userEvent.setup()
  const selectedApp = {
    resource_id: 'selected-app',
    resource_type: 'app' as const,
    display_name: 'Selected app',
    workspace_id: 'workspace-id',
    workspace_name: 'Workspace',
    available: true,
    reason: null,
  }
  let rejectInitial: ((reason?: unknown) => void) | undefined
  let attempts = 0
  transport.call.mockImplementation(() => {
    attempts += 1
    if (attempts === 1)
      return new Promise((_resolve, reject) => {
        rejectInitial = reject
      })
    return { data: [], next_cursor: null, has_more: false }
  })
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <ResourcePicker selected={[selectedApp]} onToggle={vi.fn()} />
    </QueryClientProvider>,
  )
  expect(
    await screen.findByText('accountSettings.resourceAccessToken.loadingResources'),
  ).toBeInTheDocument()
  expect(
    screen.getByText('accountSettings.resourceAccessToken.selectionPreservedLoading'),
  ).toBeInTheDocument()
  expect(
    screen.getByRole('checkbox', { name: 'dataset.metadata.datasetMetadata.builtIn' }),
  ).toBeChecked()
  await act(async () => {
    rejectInitial?.(new Error('resource catalog unavailable'))
  })
  expect(await screen.findByRole('alert')).toBeInTheDocument()
  expect(
    screen.getByText('accountSettings.resourceAccessToken.couldNotLoadResources'),
  ).toBeInTheDocument()
  expect(
    screen.getByText('accountSettings.resourceAccessToken.selectionPreservedError'),
  ).toBeInTheDocument()
  expect(
    screen.getByRole('checkbox', { name: 'dataset.metadata.datasetMetadata.builtIn' }),
  ).toBeChecked()
  await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))
  await vi.waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  expect(
    screen.getByRole('checkbox', { name: 'dataset.metadata.datasetMetadata.builtIn' }),
  ).toBeChecked()
})

it('shows token expiration dates in ISO format', async () => {
  transport.call.mockResolvedValue({
    data: [{ ...token, expires_at: '2026-09-29T00:00:00Z' }],
    page: 1,
    limit: 20,
    total: 1,
    has_more: false,
  })
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <PersonalAccessTokens />
    </QueryClientProvider>,
  )
  const table = await screen.findByRole('table')
  expect(within(table).getByText('2026-09-29')).toBeInTheDocument()
})

it('shows expiration status and deployment beside the workspace in scope details', async () => {
  const user = userEvent.setup()
  const expiredToken = {
    ...token,
    status: 'expired' as const,
    expires_at: '2026-09-29T00:00:00Z',
  }
  transport.call.mockImplementation(async (path: string[]) =>
    path.includes('byTokenId')
      ? {
          token: expiredToken,
          resources: [
            {
              resource_id: 'app-id',
              resource_type: 'app',
              display_name: 'Customer FAQ Bot',
              workspace_id: 'workspace-id',
              workspace_name: 'Acme',
              available: true,
              reason: null,
              app_runners: [
                {
                  resource_id: 'runner-id',
                  resource_type: 'app_runner',
                  display_name: 'Customer FAQ Bot / Production',
                  workspace_id: 'workspace-id',
                  workspace_name: 'Acme',
                  available: true,
                  reason: null,
                },
              ],
            },
            {
              resource_id: 'built-in-app-id',
              resource_type: 'app',
              display_name: 'Built-in app',
              workspace_id: 'workspace-id',
              workspace_name: "fatelei's Workspace",
              available: true,
              reason: null,
              app_runners: [],
            },
            {
              resource_id: 'dataset-id',
              resource_type: 'dataset',
              display_name: 'Internal Docs',
              workspace_id: 'workspace-id',
              workspace_name: 'Acme',
              available: false,
              reason: 'access_removed',
            },
          ],
          workspaces: [
            {
              workspace_id: 'workspace-missing',
              display_name: 'Missing workspace',
              role: null,
              available: false,
            },
          ],
        }
      : { data: [expiredToken], page: 1, limit: 20, total: 1, has_more: false },
  )
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <PersonalAccessTokens />
    </QueryClientProvider>,
  )
  await user.click(await screen.findByRole('button', { name: 'release-pipeline' }))
  const dialog = await screen.findByRole('dialog', {
    name: 'accountSettings.personalAccessToken.scopeTitle',
  })
  expect(dialog).toHaveTextContent('accountSettings.resourceAccessToken.createdColumn · 2026-10-15')
  const expirationMessage = within(dialog).getByText(
    'accountSettings.personalAccessToken.expired on 2026-09-29',
  )
  expect(expirationMessage).toHaveClass('text-text-destructive')
  expect(expirationMessage).toHaveClass('mt-1')
  expect(within(dialog).getByText('Acme · Production')).toBeInTheDocument()
  expect(
    within(dialog).getByText('fatelei · dataset.metadata.datasetMetadata.builtIn'),
  ).toBeInTheDocument()
  expect(
    within(dialog).getByText('accountSettings.resourceAccessToken.app · ID: app-id'),
  ).toBeInTheDocument()
  expect(
    within(dialog).getByText('accountSettings.resourceAccessToken.knowledge · ID: dataset-id'),
  ).toBeInTheDocument()
  expect(
    within(dialog).getByText(
      'accountSettings.personalAccessToken.unavailableResourcesAndWorkspaces:{"count":2}',
    ),
  ).toBeInTheDocument()
})

it.each([
  ['owner', 'roleOwner'],
  ['admin', 'roleAdmin'],
  ['editor', 'roleEditor'],
  ['normal', 'roleMember'],
  ['dataset_operator', 'roleDatasetOperator'],
])('shows localized workspace role %s in authorization details', async (role, label) => {
  const user = userEvent.setup()
  transport.call.mockImplementation(async (path: string[]) =>
    path.includes('byTokenId')
      ? {
          token,
          resources: [
            {
              resource_id: '019a0000-0000-7000-8000-000000000002',
              resource_type: 'app',
              display_name: 'Support assistant',
              workspace_id: '019a0000-0000-7000-8000-000000000003',
              workspace_name: 'Production',
              available: false,
              reason: 'access_removed',
            },
          ],
          workspaces: [
            {
              workspace_id: '019a0000-0000-7000-8000-000000000003',
              display_name: 'Production',
              available: true,
              reason: null,
              role,
            },
          ],
        }
      : { data: [token], page: 1, limit: 20, total: 1, has_more: false },
  )
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <PersonalAccessTokens />
    </QueryClientProvider>,
  )
  await user.click(await screen.findByRole('button', { name: 'release-pipeline' }))
  const dialog = await screen.findByRole('dialog', {
    name: 'accountSettings.personalAccessToken.scopeTitle',
  })
  expect(await within(dialog).findByText('Support assistant')).toBeInTheDocument()
  expect(
    within(dialog).getByText('accountSettings.personalAccessToken.accessRemoved'),
  ).toBeInTheDocument()
  expect(
    within(dialog).getByText(`accountSettings.personalAccessToken.${label}`),
  ).toBeInTheDocument()
})

it('creates a token with the chosen lifetime and only retrieves its secret after creation', async () => {
  const user = userEvent.setup()
  transport.call.mockImplementation(async (path: string[]) => {
    if (path.includes('secret')) return { secret: 'dpat_test_complete_secret_7f21' }
    if (path.at(-1) === 'post') return token
    return { data: [], page: 1, limit: 20, total: 0, has_more: false }
  })
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <PersonalAccessTokens />
    </QueryClientProvider>,
  )
  await user.click(
    screen.getByRole('button', { name: 'accountSettings.personalAccessToken.createButton' }),
  )
  const dialog = await screen.findByRole('dialog')
  await user.type(
    within(dialog).getByRole('textbox', { name: 'accountSettings.resourceAccessToken.name' }),
    'release',
  )
  await user.click(within(dialog).getByRole('button', { name: 'common.operation.create' }))
  expect(await screen.findByDisplayValue('dpat_test_complete_secret_7f21')).toBeInTheDocument()
  const createCall = transport.call.mock.calls.find(
    ([path]) => path.at(-1) === 'post' && !path.includes('secret'),
  )
  expect(createCall?.[1].body).toEqual({
    name: 'release',
    expiration: '90_days',
    resource_scope: { mode: 'all', resources: [] },
    workspace_scope: { mode: 'all', workspace_ids: [] },
  })
})

it('keeps selected apps across search and submits only the selected scope', async () => {
  const user = userEvent.setup()
  const app = {
    resource_id: '019a0000-0000-7000-8000-000000000002',
    resource_type: 'app',
    display_name: 'Support assistant',
    workspace_id: '019a0000-0000-7000-8000-000000000003',
    workspace_name: 'Production',
    available: true,
    reason: null,
  }
  transport.call.mockImplementation(
    async (path: string[], input: { query?: { keyword?: string } }) => {
      if (path.includes('personalAccessTokenResources'))
        return { data: input.query?.keyword ? [] : [app], next_cursor: null, has_more: false }
      if (path.includes('secret')) return { secret: 'dpat_test_complete_secret_7f21' }
      if (path.at(-1) === 'post') return token
      return { data: [], page: 1, limit: 20, total: 0, has_more: false }
    },
  )
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <PersonalAccessTokens />
    </QueryClientProvider>,
  )
  await user.click(
    screen.getByRole('button', { name: 'accountSettings.personalAccessToken.createButton' }),
  )
  const dialog = await screen.findByRole('dialog')
  await user.type(
    within(dialog).getByRole('textbox', { name: 'accountSettings.resourceAccessToken.name' }),
    'one-app',
  )
  const resources = within(dialog).getByRole('radiogroup', {
    name: 'accountSettings.resourceAccessToken.resources',
  })
  await user.click(
    within(resources).getByRole('radio', { name: 'accountSettings.personalAccessToken.selected' }),
  )
  await user.click(
    await within(dialog).findByRole('checkbox', {
      name: 'dataset.metadata.datasetMetadata.builtIn',
    }),
  )
  await user.type(within(dialog).getByRole('searchbox'), 'no-match')
  const workspaces = within(dialog).getByRole('radiogroup', {
    name: 'accountSettings.personalAccessToken.manageWorkspaces',
  })
  await user.click(
    within(workspaces).getByRole('radio', { name: 'accountSettings.personalAccessToken.none' }),
  )
  await user.click(within(dialog).getByRole('button', { name: 'common.operation.create' }))
  expect(await screen.findByDisplayValue('dpat_test_complete_secret_7f21')).toBeInTheDocument()
  const createCall = transport.call.mock.calls.find(
    ([path]) => path.at(-1) === 'post' && !path.includes('secret'),
  )
  expect(createCall?.[1].body.resource_scope).toEqual({
    mode: 'selected',
    resources: [{ resource_id: app.resource_id, resource_type: 'app' }],
  })
  expect(createCall?.[1].body.workspace_scope).toEqual({ mode: 'none', workspace_ids: [] })
})

it('preserves the draft version across background refresh and reloads explicitly after a conflict', async () => {
  const user = userEvent.setup()
  const client = createTestQueryClient()
  const saved = {
    token: { ...token, resource_scope_mode: 'all' as const, workspace_scope_mode: 'all' as const },
    resources: [],
    workspaces: [],
  }
  const latest = { ...saved, token: { ...saved.token, name: 'changed elsewhere', version: 2 } }
  client.setQueryData(
    consoleQuery.account.personalAccessTokens.byTokenId.get.queryOptions({
      input: { params: { token_id: token.id } },
    }).queryKey,
    saved,
  )
  transport.call.mockImplementation(async (path: string[], input) => {
    if (path.at(-1) === 'patch') {
      if (input.body.version === 1) throw new ORPCError('CONFLICT', { status: 409 })
      return latest.token
    }
    if (path.includes('byTokenId')) return latest
    return { data: [token], page: 1, limit: 20, total: 1, has_more: false }
  })
  render(
    <QueryClientProvider client={client}>
      <PersonalAccessTokens />
    </QueryClientProvider>,
  )
  await user.click(await screen.findByRole('button', { name: 'common.operation.edit' }))
  const dialog = await screen.findByRole('dialog')
  const name = await within(dialog).findByRole('textbox', {
    name: 'accountSettings.resourceAccessToken.name',
  })
  await user.clear(name)
  await user.type(name, 'my draft')
  await user.click(within(dialog).getByRole('button', { name: 'common.operation.save' }))
  await vi.waitFor(() =>
    expect(
      transport.call.mock.calls.find(([path]) => path.at(-1) === 'patch')?.[1].body.version,
    ).toBe(1),
  )
  expect(name).toHaveValue('my draft')
  expect(await within(dialog).findByRole('alert')).toHaveTextContent(
    'accountSettings.personalAccessToken.conflict',
  )
  expect(
    transport.call.mock.calls.find(([path]) => path.at(-1) === 'patch')?.[2].context.silent,
  ).toBe(true)
  await user.click(
    await within(dialog).findByRole('button', {
      name: 'accountSettings.personalAccessToken.reload',
    }),
  )
  expect(await within(dialog).findByDisplayValue('changed elsewhere')).toBeInTheDocument()
  await user.click(within(dialog).getByRole('button', { name: 'common.operation.save' }))
  await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
})

it('shows clipboard failure on the created token and lets the user retry', async () => {
  const user = userEvent.setup()
  vi.mocked(copy).mockResolvedValueOnce(false).mockResolvedValueOnce(true)
  transport.call.mockImplementation(async (path: string[]) => {
    if (path.includes('secret')) return { secret: 'dpat_copy_retry' }
    if (path.at(-1) === 'post') return token
    return { data: [], page: 1, limit: 20, total: 0, has_more: false }
  })
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <PersonalAccessTokens />
    </QueryClientProvider>,
  )
  await user.click(
    screen.getByRole('button', { name: 'accountSettings.personalAccessToken.createButton' }),
  )
  const dialog = await screen.findByRole('dialog')
  await user.type(
    within(dialog).getByRole('textbox', { name: 'accountSettings.resourceAccessToken.name' }),
    'copy retry',
  )
  await user.click(within(dialog).getByRole('button', { name: 'common.operation.create' }))
  await user.click(await within(dialog).findByRole('button', { name: 'common.operation.copy' }))
  expect(await within(dialog).findByRole('alert')).toHaveTextContent(
    'common.operation.copyErrorFailed',
  )
  await user.click(within(dialog).getByRole('button', { name: 'common.operation.copy' }))
  expect(
    await within(dialog).findByRole('button', { name: 'common.operation.copied' }),
  ).toBeInTheDocument()
  expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument()
})

it('refreshes an expired token after secret retrieval is rejected', async () => {
  const user = userEvent.setup()
  let expired = false
  transport.call.mockImplementation(async (path: string[]) => {
    if (path.includes('secret')) {
      expired = true
      throw new ORPCError('FORBIDDEN', { status: 403 })
    }
    return {
      data: [{ ...token, status: expired ? 'expired' : 'active' }],
      page: 1,
      limit: 20,
      total: 1,
      has_more: false,
    }
  })
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <PersonalAccessTokens />
    </QueryClientProvider>,
  )
  await user.click(await screen.findByRole('button', { name: 'common.operation.copy' }))
  expect(await screen.findByText('accountSettings.personalAccessToken.expired')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'common.operation.copy' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'common.operation.edit' })).toBeDisabled()
})

it('restores PAT pagination from the URL and writes navigation back to it', async () => {
  const user = userEvent.setup()
  transport.call.mockImplementation(async (_path, input) => ({
    data: [token],
    page: input.query.page,
    limit: 20,
    total: 45,
    has_more: input.query.page < 3,
  }))
  const { onUrlUpdate } = render(
    <QueryClientProvider client={createTestQueryClient()}>
      <PersonalAccessTokens />
    </QueryClientProvider>,
    { searchParams: '?patPage=2' },
  )
  await screen.findByRole('table')
  expect(transport.call.mock.calls[0]?.[1].query.page).toBe(2)
  await user.click(screen.getByRole('button', { name: 'accountSettings.resourceAccessToken.next' }))
  await vi.waitFor(() =>
    expect(onUrlUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ queryString: '?patPage=3' }),
    ),
  )
})

it('preserves the editing draft but prevents another save after expiry is confirmed', async () => {
  const user = userEvent.setup()
  let expired = false
  transport.call.mockImplementation(async (path: string[]) => {
    if (path.at(-1) === 'patch') {
      expired = true
      throw new ORPCError('FORBIDDEN', { status: 403 })
    }
    const current = {
      ...token,
      status: expired ? 'expired' : 'active',
      resource_scope_mode: 'all',
      workspace_scope_mode: 'all',
    }
    if (path.includes('byTokenId')) return { token: current, resources: [], workspaces: [] }
    return { data: [current], page: 1, limit: 20, total: 1, has_more: false }
  })
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <PersonalAccessTokens />
    </QueryClientProvider>,
  )
  await user.click(await screen.findByRole('button', { name: 'common.operation.edit' }))
  const dialog = await screen.findByRole('dialog')
  const name = await within(dialog).findByRole('textbox', {
    name: 'accountSettings.resourceAccessToken.name',
  })
  await user.clear(name)
  await user.type(name, 'recoverable draft')
  await user.click(within(dialog).getByRole('button', { name: 'common.operation.save' }))
  await vi.waitFor(() =>
    expect(within(dialog).getByRole('button', { name: 'common.operation.save' })).toBeDisabled(),
  )
  expect(name).toHaveValue('recoverable draft')
})

it.each(['FORBIDDEN', 'SERVICE_UNAVAILABLE'] as const)(
  'shows %s creation failure feedback and retains the draft for retry',
  async (code) => {
    const user = userEvent.setup()
    let attempts = 0
    transport.call.mockImplementation(async (path: string[]) => {
      if (path.includes('secret')) return { secret: 'dpat_retry' }
      if (path.at(-1) === 'post') {
        attempts += 1
        if (attempts === 1) throw new ORPCError(code, { message: 'Backend English message' })
        return token
      }
      return { data: [], page: 1, limit: 20, total: 0, has_more: false }
    })
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <PersonalAccessTokens />
      </QueryClientProvider>,
    )
    await user.click(
      screen.getByRole('button', { name: 'accountSettings.personalAccessToken.createButton' }),
    )
    const dialog = await screen.findByRole('dialog')
    const name = within(dialog).getByRole('textbox', {
      name: 'accountSettings.resourceAccessToken.name',
    })
    await user.type(name, 'retained draft')
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.create' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      code === 'SERVICE_UNAVAILABLE' ? 'Backend English message' : 'common.api.actionFailed',
    )
    expect(name).toHaveValue('retained draft')
    const createCall = transport.call.mock.calls.find(([path]) => path.at(-1) === 'post')
    expect(createCall?.[2].context.silent).toBe(true)
    if (code !== 'SERVICE_UNAVAILABLE')
      expect(screen.queryByText('Backend English message')).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.create' }))
    expect(await within(dialog).findByDisplayValue('dpat_retry')).toBeInTheDocument()
  },
)

it('shows a localized retrieval failure at the copy action and retries successfully', async () => {
  const user = userEvent.setup()
  let attempts = 0
  transport.call.mockImplementation(async (path: string[]) => {
    if (path.includes('secret')) {
      if (++attempts === 1)
        throw new ORPCError('SERVICE_UNAVAILABLE', { message: 'English key error' })
      return { secret: 'dpat_recovered' }
    }
    return { data: [token], page: 1, limit: 20, total: 1, has_more: false }
  })
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <PersonalAccessTokens />
    </QueryClientProvider>,
  )
  await user.click(await screen.findByRole('button', { name: 'common.operation.copy' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'accountSettings.personalAccessToken.secretUnavailable',
  )
  expect(
    transport.call.mock.calls.find(([path]) => path.includes('secret'))?.[2].context.silent,
  ).toBe(true)
  await user.click(screen.getByRole('button', { name: 'common.operation.copy' }))
  await vi.waitFor(() => expect(copy).toHaveBeenCalledWith('dpat_recovered'))
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

it('keeps the delete confirmation open with localized feedback after failure', async () => {
  const user = userEvent.setup()
  transport.call.mockImplementation(async (path: string[]) => {
    if (path.at(-1) === 'delete') throw new ORPCError('INTERNAL_SERVER_ERROR')
    return { data: [token], page: 1, limit: 20, total: 1, has_more: false }
  })
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <PersonalAccessTokens />
    </QueryClientProvider>,
  )
  await user.click(await screen.findByRole('button', { name: 'common.operation.delete' }))
  const dialog = await screen.findByRole('alertdialog')
  await user.click(within(dialog).getByRole('button', { name: 'common.operation.delete' }))
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('common.api.actionFailed')
  expect(
    transport.call.mock.calls.find(([path]) => path.at(-1) === 'delete')?.[2].context.silent,
  ).toBe(true)
  expect(within(dialog).getByRole('button', { name: 'common.operation.delete' })).toBeEnabled()
})

it('selects a built-in app, knowledge base, and nested runner deployment with the same id independently', async () => {
  const user = userEvent.setup()
  const common = {
    resource_id: '019a0000-0000-7000-8000-000000000002',
    workspace_id: '019a0000-0000-7000-8000-000000000003',
    workspace_name: 'Production',
    available: true,
    reason: null,
  }
  transport.call.mockImplementation(async (path: string[]) => {
    if (path.includes('personalAccessTokenResources'))
      return {
        data: [
          {
            ...common,
            resource_type: 'app',
            display_name: 'Assistant',
            app_runners: [
              {
                ...common,
                resource_type: 'app_runner',
                display_name: 'Assistant / Production',
                parent_app_id: common.resource_id,
              },
            ],
          },
          { ...common, resource_type: 'dataset', display_name: 'Handbook' },
        ],
        next_cursor: null,
        has_more: false,
      }
    if (path.includes('secret')) return { secret: 'dpat_mixed_resources' }
    if (path.at(-1) === 'post') return token
    return { data: [], page: 1, limit: 20, total: 0, has_more: false }
  })
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <PersonalAccessTokens />
    </QueryClientProvider>,
  )
  await user.click(
    screen.getByRole('button', { name: 'accountSettings.personalAccessToken.createButton' }),
  )
  const dialog = await screen.findByRole('dialog')
  await user.type(
    within(dialog).getByRole('textbox', { name: 'accountSettings.resourceAccessToken.name' }),
    'mixed',
  )
  const scope = within(dialog).getByRole('radiogroup', {
    name: 'accountSettings.resourceAccessToken.resources',
  })
  await user.click(
    within(scope).getByRole('radio', { name: 'accountSettings.personalAccessToken.selected' }),
  )
  const resourceTabs = within(dialog).getByRole('group', {
    name: 'accountSettings.resourceAccessToken.resources',
  })
  await user.click(
    within(resourceTabs).getByRole('button', {
      name: 'accountSettings.resourceAccessToken.tabKnowledgeBases',
    }),
  )
  expect(within(dialog).getByRole('checkbox', { name: 'Handbook' })).toBeInTheDocument()
  expect(within(dialog).queryByRole('checkbox', { name: 'Production' })).not.toBeInTheDocument()
  await user.click(
    within(resourceTabs).getByRole('button', {
      name: 'accountSettings.resourceAccessToken.tabAll',
    }),
  )
  const builtInLabel = 'dataset.metadata.datasetMetadata.builtIn'
  await user.click(await within(dialog).findByRole('checkbox', { name: builtInLabel }))
  await user.click(within(dialog).getByRole('checkbox', { name: 'Handbook' }))
  const productionRunner = await within(dialog).findByRole('checkbox', { name: 'Production' })
  await user.hover(within(dialog).getByRole('button', { name: 'Production' }))
  expect(await screen.findByText(`deployment_id: ${common.resource_id}`)).toBeInTheDocument()
  await user.click(productionRunner)
  expect(within(dialog).getByRole('checkbox', { name: builtInLabel })).toBeChecked()
  expect(within(dialog).getByRole('checkbox', { name: 'Handbook' })).toBeChecked()
  await user.click(within(dialog).getByRole('button', { name: 'common.operation.create' }))
  await screen.findByDisplayValue('dpat_mixed_resources')
  const submitted = transport.call.mock.calls.find(
    ([path]) => path.at(-1) === 'post' && !path.includes('secret'),
  )
  expect(submitted?.[1].body.resource_scope.resources).toEqual([
    { resource_type: 'app', resource_id: common.resource_id },
    { resource_type: 'dataset', resource_id: common.resource_id },
    { resource_type: 'app_runner', resource_id: common.resource_id },
  ])
})

it('shows a workspace-switch hint instead of revoked access for a saved runner in another workspace', async () => {
  const user = userEvent.setup()
  const active = { ...token, status: 'active', unavailable_count: 0 }
  transport.call.mockImplementation(async (path: string[]) =>
    path.includes('byTokenId')
      ? {
          token: active,
          resources: [
            {
              resource_type: 'app_runner',
              resource_id: '019a0000-0000-7000-8000-000000000002',
              workspace_id: '019a0000-0000-7000-8000-000000000003',
              workspace_name: 'Other workspace',
              display_name: 'Runner / Production',
              available: false,
              reason: 'workspace_not_current',
            },
          ],
          workspaces: [],
        }
      : { data: [active], page: 1, limit: 20, total: 1, has_more: false },
  )
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <PersonalAccessTokens />
    </QueryClientProvider>,
  )
  await user.click(await screen.findByRole('button', { name: 'release-pipeline' }))
  const dialog = await screen.findByRole('dialog')
  expect(
    await within(dialog).findByText('accountSettings.personalAccessToken.workspaceNotCurrent'),
  ).toBeInTheDocument()
  expect(
    within(dialog).queryByText('accountSettings.personalAccessToken.accessRemoved'),
  ).not.toBeInTheDocument()
})
