import type { GetFeaturesResponse } from '@dify/contracts/api/console/features/types.gen'
import type { QueryClient } from '@tanstack/react-query'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { consoleQuery } from '@/service/console'
import { TEST_WORKSPACE_ID } from '@/test/console/ids'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { hold, setupFakeApi } from '@/test/fake-api'
import { MembersPage } from '../../index'

let queryClient: QueryClient
let features: GetFeaturesResponse

const fake = setupFakeApi({
  console: {
    features: { get: () => features },
    workspaces: {
      current: {
        members: {
          // A successful invitation refreshes seats and members in the background.
          get: () => ({ accounts: [] }),
          inviteEmail: {
            post: ({ body: { emails } }) => ({
              result: 'success',
              tenant_id: TEST_WORKSPACE_ID,
              invitation_results: emails.map((email) => ({
                status: 'success',
                email,
                url: 'https://example.com/invite',
              })),
            }),
          },
        },
        rbac: {
          roles: {
            get: () => ({
              data: [
                {
                  id: 'admin',
                  tenant_id: TEST_WORKSPACE_ID,
                  type: 'workspace',
                  category: 'global_system_default',
                  name: 'Admin',
                  description: 'Manage members',
                  is_builtin: true,
                  permission_keys: [],
                  role_tag: '',
                },
              ],
              pagination: { total_count: 1, per_page: 20, current_page: 1, total_pages: 1 },
            }),
          },
        },
      },
      byWorkspaceId: {
        members: { pendingInvitations: { get: () => ({ invitations: [] }) } },
      },
    },
  },
})

beforeEach(() => {
  vi.stubGlobal('BASE_UI_ANIMATIONS_DISABLED', false)
  queryClient = createConsoleQueryWrapper({
    systemFeatures: { deployment_edition: 'CLOUD', is_email_setup: true },
    workspacePermissionKeys: ['workspace.member.manage'],
    features: { workspace_members: { enabled: true, size: 1, limit: 10 } },
  }).queryClient
  features = queryClient.getQueryData(consoleQuery.features.get.queryKey())!
  queryClient.setQueryData(
    consoleQuery.workspaces.current.members.get.queryOptions({
      input: { query: { language: 'en' } },
    }).queryKey,
    { accounts: [] },
  )
})

afterEach(() => vi.unstubAllGlobals())

it('holds focus through Enter submission and returns it to Invite after a successful invitation', async () => {
  const invite = hold(fake.console.workspaces.current.members.inviteEmail.post)
  const screen = await render(
    <QueryClientTestProvider queryClient={queryClient}>
      <MembersPage />
    </QueryClientTestProvider>,
  )
  const trigger = screen.getByRole('button', { name: /members\.invite$/ })
  await trigger.click()
  const inviteDialog = screen.getByRole('dialog', { name: /members\.inviteTeamMember$/ })
  const input = screen.getByRole('textbox', { name: /members\.emailRecipients/ })
  await input.fill('person@example.com')
  await userEvent.keyboard('{Enter}')
  await expect.element(input).toHaveValue('')
  await screen.getByRole('combobox', { name: /members\.role/ }).click()
  await screen.getByRole('option', { name: /Admin/ }).click()
  const submit = screen.getByRole('button', { name: /members\.sendInvite/ })
  await input.click()
  await userEvent.keyboard('{Enter}')

  await expect.element(submit).toHaveFocus()
  await userEvent.keyboard('{Escape}')
  const outside = document.elementFromPoint(4, 4)!
  await userEvent.click(outside, { position: { x: 4, y: 4 } })
  await userEvent.tab()
  await expect.element(submit).toHaveFocus()
  await expect.element(inviteDialog).toBeVisible()

  expect((await invite.arrived).body.emails).toEqual(['person@example.com'])
  invite.release()
  // A fully successful Cloud invitation needs no result step; the new row is the feedback.
  await expect.element(inviteDialog).not.toBeInTheDocument()
  await expect.element(trigger).toHaveFocus()
})
