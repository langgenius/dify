import type {
  PersonalAccessTokenDetailResponse,
  PersonalAccessTokenResourceResponse,
  PersonalAccessTokenWorkspaceResponse,
} from '@dify/contracts/api/console/account/types.gen'
import { page, userEvent } from 'vite-plus/test/browser'
import { apiError, hold, setupFakeApi } from '@/test/fake-api'
import { renderTokenPage, token, tokenList } from './browser-test-env'

vi.unmock('react-i18next')
const workspace: PersonalAccessTokenWorkspaceResponse = {
  workspace_id: '019a0000-0000-7000-8000-000000000003',
  display_name: 'Production',
  available: true,
  reason: null,
  role: 'owner',
}
const app: PersonalAccessTokenResourceResponse = {
  resource_id: '019a0000-0000-7000-8000-000000000002',
  resource_type: 'app',
  display_name: 'Support assistant',
  workspace_id: workspace.workspace_id,
  workspace_name: workspace.display_name,
  available: true,
  reason: null,
}
const unscoped: PersonalAccessTokenDetailResponse = { token, resources: [], workspaces: [] }

const fake = setupFakeApi(() => ({
  console: {
    account: {
      personalAccessTokens: {
        get: () => tokenList(),
        post: () => ({ ...token, secret: 'dpat_scoped' }),
        byTokenId: {
          get: () => unscoped,
          patch: () => unscoped,
        },
      },
      personalAccessTokenResources: {
        get: () => ({ data: [app], next_cursor: null, has_more: false }),
      },
      personalAccessTokenWorkspaces: {
        get: () => ({ data: [workspace], next_cursor: null, has_more: false }),
      },
    },
  },
}))

beforeEach(async () => {
  await page.viewport(1100, 800)
})

it('requires each selected scope and preserves selections while switching the expanded picker', async () => {
  const { screen } = await renderTokenPage()
  await screen.getByRole('button', { name: 'Create token' }).click()
  const dialog = screen.getByRole('dialog')
  await dialog.getByRole('textbox', { name: 'Name' }).fill('workspace')
  await dialog.getByRole('combobox', { name: 'Expiration' }).click()
  await screen.getByRole('option', { name: '365 days' }).click()
  const resources = dialog.getByRole('radiogroup', { name: 'Resources' })
  const workspaces = dialog.getByRole('radiogroup', { name: 'Manage workspaces' })
  const create = dialog.getByRole('button', { name: 'Create', exact: true })
  await resources.getByRole('radio', { name: 'None' }).click()
  await expect.element(create).toBeEnabled()
  await workspaces.getByRole('radio', { name: 'Selected' }).click()
  await expect.element(create).toBeDisabled()
  await dialog.getByRole('checkbox', { name: 'Production' }).click()
  await resources.getByRole('radio', { name: 'Selected' }).click()
  await expect.element(create).toBeDisabled()
  await dialog.getByRole('checkbox', { name: 'Built-in' }).click()
  await expect.element(create).toBeEnabled()
  await expect.element(dialog.getByRole('checkbox', { name: 'Production' })).not.toBeInTheDocument()
  const editCollapsed = dialog.getByRole('button', { name: /1 Selected.*Edit/ })
  await editCollapsed.click()
  await expect.element(dialog.getByRole('checkbox', { name: 'Production' })).toBeChecked()
  await expect.element(dialog.getByRole('checkbox', { name: 'Built-in' })).not.toBeInTheDocument()
  await editCollapsed.click()
  await expect.element(dialog.getByRole('checkbox', { name: 'Built-in' })).toBeChecked()
  await workspaces.getByRole('radio', { name: 'None' }).click()
  await workspaces.getByRole('radio', { name: 'Selected' }).click()
  await editCollapsed.click()
  await expect.element(dialog.getByRole('checkbox', { name: 'Built-in' })).toBeChecked()
  await create.click()
  await expect
    .element(dialog.getByRole('textbox', { name: 'Token', exact: true }))
    .toHaveValue('dpat_scoped')
  expect(fake.console.account.personalAccessTokens.post).toHaveBeenCalledWith(
    expect.objectContaining({
      body: {
        name: 'workspace',
        expiration: '365_days',
        workspace_scope: { mode: 'selected', workspace_ids: [workspace.workspace_id] },
        resource_scope: {
          mode: 'selected',
          resources: [{ resource_id: app.resource_id, resource_type: 'app' }],
        },
      },
    }),
  )
})

it('duplicates expired access while excluding unavailable resources and workspaces', async () => {
  const expired = {
    ...token,
    status: 'expired' as const,
    created_at: '2026-07-01T00:00:00Z',
    expires_at: '2026-09-29T00:00:00Z',
    resource_count: 2,
    workspace_count: 2,
    unavailable_count: 2,
  }
  fake.console.account.personalAccessTokens.get.mockResolvedValue(tokenList([expired]))
  fake.console.account.personalAccessTokens.byTokenId.get.mockResolvedValue({
    token: expired,
    resources: [app, { ...app, resource_id: token.id, available: false, reason: 'access_removed' }],
    workspaces: [workspace, { ...workspace, workspace_id: token.id, available: false }],
  })
  const { screen } = await renderTokenPage()
  await expect.element(screen.getByRole('button', { name: 'Edit', exact: true })).toBeDisabled()
  await expect
    .element(screen.getByRole('button', { name: 'Copy', exact: true }))
    .not.toBeInTheDocument()
  await screen.getByRole('button', { name: 'Duplicate', exact: true }).click()
  const dialog = screen.getByRole('dialog')
  await expect.element(dialog.getByRole('textbox', { name: 'Name' })).toHaveValue(token.name)
  await expect.element(dialog.getByText(/1 resource.*1 workspace.*excluded/i)).toBeVisible()
  await dialog.getByRole('button', { name: 'Create', exact: true }).click()
  await expect
    .element(dialog.getByRole('textbox', { name: 'Token', exact: true }))
    .toHaveValue('dpat_scoped')
  expect(fake.console.account.personalAccessTokens.post).toHaveBeenCalledWith(
    expect.objectContaining({
      body: expect.objectContaining({
        resource_scope: {
          mode: 'selected',
          resources: [{ resource_id: app.resource_id, resource_type: 'app' }],
        },
        workspace_scope: { mode: 'selected', workspace_ids: [workspace.workspace_id] },
      }),
    }),
  )
})

it('keeps a selected resource through loading, failure, and retry with no remaining candidates', async () => {
  fake.console.account.personalAccessTokens.get.mockResolvedValue(tokenList([token]))
  fake.console.account.personalAccessTokens.byTokenId.get.mockResolvedValue({
    token: { ...token, workspace_scope_mode: 'none' },
    resources: [app],
    workspaces: [],
  })
  const resources = fake.console.account.personalAccessTokenResources.get
  const request = hold(resources)
  resources.mockResolvedValue({ data: [], next_cursor: null, has_more: false })
  const { screen } = await renderTokenPage()
  await screen.getByRole('button', { name: 'Edit', exact: true }).click()
  const dialog = screen.getByRole('dialog')
  const selected = dialog.getByRole('checkbox', { name: 'Built-in' })
  await expect.element(selected).toBeChecked()
  await expect.element(dialog.getByText('Your existing selection is preserved.')).toBeVisible()
  request.reject(
    apiError({ status: 503, code: 'SERVICE_UNAVAILABLE', message: 'Resource catalog unavailable' }),
  )
  await expect.element(dialog.getByRole('alert')).toMatchTextContent(/Couldn't load resources/)
  await expect.element(selected).toBeChecked()
  await dialog.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect.element(dialog.getByRole('alert')).not.toBeInTheDocument()
  await expect.element(selected).toBeChecked()
})

it('keeps saved dataset resources on save while offering only apps and deployments', async () => {
  const deployment = {
    ...app,
    resource_type: 'app_deployment' as const,
    display_name: 'Support assistant / Production',
    parent_app_id: app.resource_id,
  }
  const dataset = { ...app, resource_type: 'dataset' as const, display_name: 'Handbook' }
  const appWithDeployments = { ...app, app_deployments: [deployment] }
  fake.console.account.personalAccessTokens.get.mockResolvedValue(tokenList([token]))
  fake.console.account.personalAccessTokens.byTokenId.get.mockResolvedValue({
    token,
    resources: [appWithDeployments, dataset],
    workspaces: [workspace],
  })
  fake.console.account.personalAccessTokenResources.get.mockResolvedValue({
    data: [appWithDeployments],
    next_cursor: null,
    has_more: false,
  })
  const { screen } = await renderTokenPage()
  await screen.getByRole('button', { name: 'Edit', exact: true }).click()
  const dialog = screen.getByRole('dialog')
  await expect.element(dialog.getByRole('tab')).not.toBeInTheDocument()
  await expect.element(dialog.getByRole('checkbox', { name: 'Handbook' })).not.toBeInTheDocument()
  await expect.element(dialog.getByRole('checkbox', { name: 'Built-in' })).toBeChecked()
  await dialog.getByRole('button', { name: 'Production', exact: true }).hover()
  await expect.element(screen.getByText(`deployment_id: ${app.resource_id}`)).toBeVisible()
  await userEvent.unhover(document.body)
  await dialog.getByRole('checkbox', { name: 'Production' }).click()
  await expect.element(dialog.getByRole('checkbox', { name: 'Built-in' })).toBeChecked()
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()
  await expect.element(dialog).not.toBeInTheDocument()
  expect(fake.console.account.personalAccessTokens.byTokenId.patch).toHaveBeenCalledWith(
    expect.objectContaining({
      body: expect.objectContaining({
        resource_scope: {
          mode: 'selected',
          resources: [
            { resource_type: 'app', resource_id: app.resource_id },
            { resource_type: 'dataset', resource_id: app.resource_id },
            { resource_type: 'app_deployment', resource_id: app.resource_id },
          ],
        },
      }),
    }),
  )
})
