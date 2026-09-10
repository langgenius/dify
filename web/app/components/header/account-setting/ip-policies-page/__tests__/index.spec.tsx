import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
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
  'studio.accessControl.emptyPoliciesDescription':
    'A policy is the list of IP addresses allowed in. Create one, then come back to apply it here.',
  'studio.accessControl.emptyPoliciesTitle': 'No IP policies in this workspace yet',
  'studio.accessControl.policySummaryTwo': 'Allows {{first}} and {{second}}',
}))

vi.mock('react-i18next', async () => {
  const { createReactI18nextMock } = await import('@/test/i18n-mock')
  return createReactI18nextMock(translations)
})

describe('IpPoliciesPage', () => {
  it('opens the new policy dialog from Add', async () => {
    const user = userEvent.setup()
    const queryClient = createConsoleQueryClient()
    seedNetworkAccessGroups(queryClient, { entitled: true, groups: [] })
    renderWithConsoleQuery(
      <NuqsTestingAdapter>
        <IpPoliciesPage />
      </NuqsTestingAdapter>,
      { queryClient },
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
      { queryClient },
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
      { queryClient },
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
              icon: null,
              icon_type: null,
              icon_background: null,
            },
            { id: 'app-b', name: 'Helpdesk', icon: null, icon_type: null, icon_background: null },
          ],
        }),
      ],
    })
    renderWithConsoleQuery(
      <NuqsTestingAdapter>
        <IpPoliciesPage />
      </NuqsTestingAdapter>,
      { queryClient },
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
              icon: null,
              icon_type: null,
              icon_background: null,
            },
            { id: 'app-b', name: 'Helpdesk', icon: null, icon_type: null, icon_background: null },
          ],
        }),
      ],
    })
    renderWithConsoleQuery(
      <NuqsTestingAdapter>
        <IpPoliciesPage />
      </NuqsTestingAdapter>,
      { queryClient },
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
