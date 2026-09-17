import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { seedCurrentWorkspaceQuery } from '@/test/console/current-workspace'
import {
  createNetworkAccessGroupFixture,
  seedNetworkAccessGroups,
} from '@/test/console/network-access'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import IpPoliciesPage from '..'

const translations = vi.hoisted(() => ({
  'operation.cancel': 'Cancel',
  'operation.close': 'Close',
  'operation.delete': 'Delete',
  'operation.edit': 'Edit',
  'operation.moreActionsFor': 'More actions for {{name}}',
  'operation.save': 'Save',
  'settings.ipPolicies': 'IP Policies',
  'settings.ipPoliciesDescription':
    'Reusable rules that control which IP addresses or ranges can access your apps',
  'settings.ipPolicyAddEntry': 'Add',
  'settings.ipPolicyAllowlist': 'Allowlist',
  'settings.ipPolicyAllowlistHelp':
    'Single addresses (203.0.113.42) or CIDR ranges (10.0.0.0/8). IPv4 and IPv6 are both accepted.',
  'settings.ipPolicyColumnEnforcing': 'Enforcing',
  'settings.ipPolicyColumnIpEntries': 'IP entries',
  'settings.ipPolicyColumnName': 'Name',
  'settings.ipPolicyColumnUpdatedAt': 'Updated at',
  'settings.ipPolicyCreate': 'Create',
  'settings.ipPolicyEnforcingMany': '{{count}} apps',
  'settings.ipPolicyEnforcingNone': '0 apps',
  'settings.ipPolicyEnforcingOne': '1 app',
  'settings.ipPolicyDeleteBound': 'This policy is in use',
  'settings.ipPolicyDeleteBoundDescription':
    '{{name}} is applied to {{count}} apps. Deleting it turns off IP restriction for those apps, so they can be reached from any IP. Other app permissions stay the same.',
  'settings.ipPolicyDeleteConfirm': 'Delete “{{name}}”?',
  'settings.ipPolicyUsedByLabel': 'Used by',
  'settings.ipPolicyDialogDescription':
    'Specify which IP addresses or ranges can access your apps.',
  'settings.ipPolicyEditTitle': 'Edit IP Policy',
  'settings.ipPolicyName': 'Name',
  'settings.ipPolicyNamePlaceholder': 'e.g. Internal Network',
  'settings.ipPolicyNewTitle': 'New IP Policy',
  'settings.ipPolicyRemoveEntry': 'Remove entry',
  'studio.accessControl.emptyPoliciesTitle': 'No IP policies in this workspace yet',
  'studio.accessControl.policySummaryTwo': 'Allows {{first}} and {{second}}',
}))

vi.mock('react-i18next', async () => {
  const { createReactI18nextMock } = await import('@/test/i18n-mock')
  return createReactI18nextMock(translations)
})

describe('IpPoliciesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each([true, false])(
    'lets an editor read the complete policy without management actions (entitled: %s)',
    async (entitled) => {
      const user = userEvent.setup()
      const queryClient = createConsoleQueryClient()
      seedNetworkAccessGroups(queryClient, {
        entitled,
        groups: [
          createNetworkAccessGroupFixture({
            allowed_cidrs: ['203.0.113.42/32', '198.51.100.0/24', '2001:db8::/32'],
            used_by_count: 1,
            app_ids: ['app-a'],
            apps: [
              {
                id: 'app-a',
                name: 'Support Bot',
                mode: 'chat',
                icon: null,
                icon_type: null,
                icon_background: null,
              },
            ],
          }),
        ],
      })
      renderWithConsoleQuery(
        <NuqsTestingAdapter>
          <IpPoliciesPage />
        </NuqsTestingAdapter>,
        {
          queryClient,
          currentWorkspace: { role: 'editor' },
          systemFeatures: { deployment_edition: 'CLOUD' },
        },
      )

      expect(screen.queryByRole('button', { name: 'Add' })).not.toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'More actions for Internal Network' }),
      ).not.toBeInTheDocument()
      await user.tab()
      expect(screen.getByRole('button', { name: 'Internal Network' })).toHaveFocus()
      await user.keyboard('{Enter}')

      const dialog = screen.getByRole('dialog', { name: 'Internal Network' })
      expect(within(dialog).getByText('203.0.113.42/32')).toBeInTheDocument()
      expect(within(dialog).getByText('198.51.100.0/24')).toBeInTheDocument()
      expect(within(dialog).getByText('2001:db8::/32')).toBeInTheDocument()
      expect(within(dialog).getByRole('link', { name: 'Support Bot' })).toBeInTheDocument()
      expect(within(dialog).queryByRole('textbox')).not.toBeInTheDocument()
      expect(
        within(dialog).queryByRole('button', { name: /Create|Save|Delete|Add/ }),
      ).not.toBeInTheDocument()
      await user.keyboard('{Escape}')
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(globalThis.fetch).not.toHaveBeenCalled()
    },
  )

  it.each(['edit', 'delete'] as const)(
    'allows an entitled administrator to %s a policy',
    async (action) => {
      const user = userEvent.setup()
      const group = createNetworkAccessGroupFixture({ version: 7 })
      const requests: Array<{ method: string; url: string; body: unknown }> = []
      vi.mocked(globalThis.fetch).mockImplementation(async (input, init) => {
        const request = input instanceof Request ? input : new Request(String(input), init)
        const body = await request.text()
        requests.push({
          method: request.method,
          url: request.url,
          body: body ? JSON.parse(body) : null,
        })
        return request.method === 'DELETE'
          ? new Response(null, { status: 204 })
          : new Response(JSON.stringify({ group, entitled: true }), {
              headers: { 'content-type': 'application/json' },
            })
      })
      const queryClient = createConsoleQueryClient()
      seedNetworkAccessGroups(queryClient, { groups: [group] })
      renderWithConsoleQuery(
        <NuqsTestingAdapter>
          <IpPoliciesPage />
        </NuqsTestingAdapter>,
        {
          queryClient,
          currentWorkspace: { role: 'admin' },
          systemFeatures: { deployment_edition: 'CLOUD' },
        },
      )

      await user.click(screen.getByRole('button', { name: 'More actions for Internal Network' }))
      await user.click(
        screen.getByRole('menuitem', { name: action === 'edit' ? 'Edit' : 'Delete' }),
      )
      if (action === 'edit') {
        await user.clear(screen.getByRole('textbox', { name: 'Name' }))
        await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Office Network')
        await user.click(screen.getByRole('button', { name: 'Save' }))
      } else {
        await user.click(
          within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }),
        )
      }

      await waitFor(() =>
        expect(requests).toContainEqual(
          action === 'edit'
            ? {
                method: 'PUT',
                url: 'http://localhost:5001/console/api/workspaces/current/network-access-groups/group-1',
                body: {
                  name: 'Office Network',
                  description: '',
                  allowed_cidrs: group.allowed_cidrs,
                  expected_version: 7,
                },
              }
            : {
                method: 'DELETE',
                url: 'http://localhost:5001/console/api/workspaces/current/network-access-groups/group-1?expected_version=7',
                body: null,
              },
        ),
      )
    },
  )

  it.each(['create', 'edit', 'delete'] as const)(
    'stops %s when manager permission is revoked',
    async (action) => {
      const user = userEvent.setup()
      const queryClient = createConsoleQueryClient()
      seedNetworkAccessGroups(queryClient, { groups: [createNetworkAccessGroupFixture()] })
      renderWithConsoleQuery(
        <NuqsTestingAdapter>
          <IpPoliciesPage />
        </NuqsTestingAdapter>,
        {
          queryClient,
          currentWorkspace: { role: 'admin' },
          systemFeatures: { deployment_edition: 'CLOUD' },
        },
      )

      if (action === 'create') {
        await user.click(screen.getByRole('button', { name: 'Add' }))
        await user.type(screen.getByRole('textbox', { name: 'Name' }), 'New policy')
        await user.type(screen.getByPlaceholderText('10.0.0.0/8'), '10.0.0.0/8')
      } else {
        await user.click(screen.getByRole('button', { name: 'More actions for Internal Network' }))
        await user.click(
          screen.getByRole('menuitem', { name: action === 'edit' ? 'Edit' : 'Delete' }),
        )
        if (action === 'edit')
          await user.type(screen.getByRole('textbox', { name: 'Name' }), ' draft')
      }

      await act(async () => {
        seedCurrentWorkspaceQuery(queryClient, { role: 'editor' })
      })

      await waitFor(() => {
        expect(screen.queryByRole('button', { name: 'Add' })).not.toBeInTheDocument()
        expect(
          screen.queryByRole('button', { name: /^(Create|Save|Delete)$/ }),
        ).not.toBeInTheDocument()
        expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
      })
      if (action === 'edit') {
        expect(screen.getByRole('dialog', { name: 'Internal Network' })).toBeInTheDocument()
        expect(screen.queryByText('Internal Network draft')).not.toBeInTheDocument()
      } else {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
      }
      expect(globalThis.fetch).not.toHaveBeenCalled()
    },
  )

  it.each(['normal', 'dataset_operator'] as const)(
    'does not query or render policies for %s',
    (role) => {
      const queryClient = createConsoleQueryClient()
      renderWithConsoleQuery(
        <NuqsTestingAdapter>
          <IpPoliciesPage />
        </NuqsTestingAdapter>,
        {
          queryClient,
          currentWorkspace: { role },
          systemFeatures: { deployment_edition: 'CLOUD' },
        },
      )

      expect(screen.queryByRole('heading', { name: 'IP Policies' })).not.toBeInTheDocument()
      expect(globalThis.fetch).not.toHaveBeenCalled()
    },
  )

  it('opens the new policy dialog from Add', async () => {
    const user = userEvent.setup()
    const queryClient = createConsoleQueryClient()
    seedNetworkAccessGroups(queryClient, { entitled: true, groups: [] })
    renderWithConsoleQuery(
      <NuqsTestingAdapter>
        <IpPoliciesPage />
      </NuqsTestingAdapter>,
      { queryClient, systemFeatures: { deployment_edition: 'CLOUD' } },
    )

    expect(screen.getByText('No IP policies in this workspace yet')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Add' }))
    expect(screen.getByRole('heading', { name: 'New IP Policy' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled()
  })

  it('posts a new policy when Create is clicked', async () => {
    const user = userEvent.setup()
    const created = createNetworkAccessGroupFixture({ name: 'Office' })
    const posted: Array<{ method: string; url: string; body: unknown }> = []
    vi.mocked(globalThis.fetch).mockImplementation(async (input, init) => {
      const request = input instanceof Request ? input : new Request(String(input), init)
      const bodyText =
        request.method === 'GET' || request.method === 'HEAD' ? '' : await request.text()
      posted.push({
        method: request.method,
        url: request.url,
        body: bodyText ? JSON.parse(bodyText) : null,
      })
      return new Response(JSON.stringify({ group: created, entitled: true }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      })
    })
    const queryClient = createConsoleQueryClient()
    seedNetworkAccessGroups(queryClient, { entitled: true, groups: [] })
    renderWithConsoleQuery(
      <NuqsTestingAdapter>
        <IpPoliciesPage />
      </NuqsTestingAdapter>,
      { queryClient, systemFeatures: { deployment_edition: 'CLOUD' } },
    )

    await user.click(screen.getByRole('button', { name: 'Add' }))
    await user.type(screen.getByPlaceholderText('e.g. Internal Network'), 'Office')
    await user.type(screen.getByPlaceholderText('10.0.0.0/8'), '10.0.0.0/8')
    expect(screen.getByRole('button', { name: 'Create' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => {
      expect(posted).toContainEqual({
        method: 'POST',
        url: 'http://localhost:5001/console/api/workspaces/current/network-access-groups',
        body: {
          name: 'Office',
          description: '',
          allowed_cidrs: ['10.0.0.0/8'],
        },
      })
    })
  })

  it('lists existing policies and opens edit from the row', async () => {
    const user = userEvent.setup()
    const queryClient = createConsoleQueryClient()
    seedNetworkAccessGroups(queryClient, {
      entitled: true,
      groups: [createNetworkAccessGroupFixture()],
    })
    renderWithConsoleQuery(
      <NuqsTestingAdapter>
        <IpPoliciesPage />
      </NuqsTestingAdapter>,
      { queryClient, systemFeatures: { deployment_edition: 'CLOUD' } },
    )

    expect(screen.getByText('Internal Network')).toBeInTheDocument()
    expect(screen.getByText('Name')).toBeInTheDocument()
    expect(screen.getByText('IP entries')).toBeInTheDocument()
    expect(screen.getByText('Enforcing')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('0 apps')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'More actions for Internal Network' }))
    await user.click(screen.getByRole('menuitem', { name: 'Edit' }))
    expect(screen.getByRole('heading', { name: 'Edit IP Policy' })).toBeInTheDocument()
    expect(screen.getByDisplayValue('Internal Network')).toBeInTheDocument()
  })

  it('warns that editing a used policy updates every referencing app', async () => {
    const user = userEvent.setup()
    const queryClient = createConsoleQueryClient()
    seedNetworkAccessGroups(queryClient, {
      entitled: true,
      groups: [
        createNetworkAccessGroupFixture({
          used_by_count: 2,
          app_ids: ['app-a', 'app-b'],
          apps: [
            {
              id: 'app-a',
              name: 'Support Bot',
              mode: 'chat',
              icon: null,
              icon_type: null,
              icon_background: null,
            },
            {
              id: 'app-b',
              name: 'Helpdesk',
              mode: 'chat',
              icon: null,
              icon_type: null,
              icon_background: null,
            },
          ],
        }),
      ],
    })
    renderWithConsoleQuery(
      <NuqsTestingAdapter>
        <IpPoliciesPage />
      </NuqsTestingAdapter>,
      { queryClient, systemFeatures: { deployment_edition: 'CLOUD' } },
    )

    await user.click(screen.getByRole('button', { name: 'More actions for Internal Network' }))
    await user.click(screen.getByRole('menuitem', { name: 'Edit' }))
    expect(screen.getByText('Used by')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Support Bot' })).toHaveAttribute(
      'href',
      '/app/app-a/overview',
    )
    expect(screen.getByRole('link', { name: 'Support Bot' })).toHaveAttribute('target', '_blank')
  })

  it('lets the user delete a referenced policy after confirming the impact', async () => {
    const user = userEvent.setup()
    const queryClient = createConsoleQueryClient()
    seedNetworkAccessGroups(queryClient, {
      entitled: true,
      groups: [
        createNetworkAccessGroupFixture({
          used_by_count: 2,
          app_ids: ['app-a', 'app-b'],
          apps: [
            {
              id: 'app-a',
              name: 'Support Bot',
              mode: 'chat',
              icon: null,
              icon_type: null,
              icon_background: null,
            },
            {
              id: 'app-b',
              name: 'Helpdesk',
              mode: 'chat',
              icon: null,
              icon_type: null,
              icon_background: null,
            },
          ],
        }),
      ],
    })
    renderWithConsoleQuery(
      <NuqsTestingAdapter>
        <IpPoliciesPage />
      </NuqsTestingAdapter>,
      { queryClient, systemFeatures: { deployment_edition: 'CLOUD' } },
    )

    await user.click(screen.getByRole('button', { name: 'More actions for Internal Network' }))
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }))
    expect(screen.getByRole('heading', { name: 'Delete “Internal Network”?' })).toBeInTheDocument()
    expect(
      screen.getByText(
        'Internal Network is applied to 2 apps. Deleting it turns off IP restriction for those apps, so they can be reached from any IP. Other app permissions stay the same.',
      ),
    ).toBeInTheDocument()
    const dialog = screen.getByRole('alertdialog')
    expect(within(dialog).getByRole('button', { name: 'Delete' })).toBeEnabled()
    expect(within(dialog).getByRole('link', { name: 'Support Bot' })).toHaveAttribute(
      'href',
      '/app/app-a/overview',
    )
  })
})
