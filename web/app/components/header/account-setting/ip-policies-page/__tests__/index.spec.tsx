import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { initReactI18next } from 'react-i18next'
import commonTranslations from '@/i18n/en-US/common.json'
import deploymentTranslations from '@/i18n/en-US/deployments.json'
import { seedCurrentWorkspaceQuery } from '@/test/console/current-workspace'
import {
  createNetworkAccessGroupFixture,
  seedNetworkAccessGroups,
} from '@/test/console/network-access'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import IpPoliciesPage from '..'

vi.unmock('react-i18next')

describe('IpPoliciesPage', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    vi.mocked(globalThis.fetch).mockImplementation(async () =>
      Response.json({ client_ip: '203.0.113.42' }),
    )
    await createInstance()
      .use(initReactI18next)
      .init({
        lng: 'en-US',
        fallbackLng: 'en-US',
        defaultNS: 'common',
        keySeparator: false,
        interpolation: { escapeValue: false },
        resources: { 'en-US': { common: commonTranslations, deployments: deploymentTranslations } },
      })
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
      expect(
        vi
          .mocked(globalThis.fetch)
          .mock.calls.filter(([input, init]) => new Request(input, init).method !== 'GET'),
      ).toHaveLength(0)
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
    expect(screen.getByText('IP Entries')).toBeInTheDocument()
    expect(screen.getByText('Used by')).toBeInTheDocument()
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
    expect(within(screen.getByRole('dialog')).getByText('Used by')).toBeInTheDocument()
    expect(
      screen.getByText('Changes take effect immediately wherever this policy is applied.'),
    ).toBeInTheDocument()
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
    const dialog = screen.getByRole('alertdialog', { name: 'Delete “Internal Network”?' })
    expect(dialog).toHaveAccessibleDescription(
      'Apps using this policy will become accessible from any IP address. This can’t be undone.',
    )
    expect(within(dialog).getByText('Still used by 2 apps')).toBeInTheDocument()
    expect(globalThis.fetch).not.toHaveBeenCalled()
    expect(within(dialog).getByRole('button', { name: 'Delete' })).toBeEnabled()
    expect(within(dialog).getByRole('link', { name: 'Support Bot' })).toHaveAttribute(
      'href',
      '/app/app-a/overview',
    )
  })

  it.each(['Cancel', 'Close'])(
    'dismisses deletion through %s without deleting the policy',
    async (button) => {
      const user = userEvent.setup()
      const queryClient = createConsoleQueryClient()
      seedNetworkAccessGroups(queryClient, { groups: [createNetworkAccessGroupFixture()] })
      renderWithConsoleQuery(
        <NuqsTestingAdapter>
          <IpPoliciesPage />
        </NuqsTestingAdapter>,
        { queryClient, systemFeatures: { deployment_edition: 'CLOUD' } },
      )

      await user.click(screen.getByRole('button', { name: 'More actions for Internal Network' }))
      await user.click(screen.getByRole('menuitem', { name: 'Delete' }))
      const dialog = screen.getByRole('alertdialog', { name: 'Delete “Internal Network”?' })
      expect(dialog).toHaveAccessibleDescription('This can’t be undone.')
      expect(within(dialog).queryByText(/Still used by/)).not.toBeInTheDocument()
      await user.click(within(dialog).getByRole('button', { name: button }))

      await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
      expect(screen.getByRole('button', { name: 'Internal Network' })).toBeInTheDocument()
      expect(globalThis.fetch).not.toHaveBeenCalled()
    },
  )

  it.each([true, false])(
    'waits for deletion and only closes on success (success: %s)',
    async (succeeds) => {
      const user = userEvent.setup()
      const queryClient = createConsoleQueryClient()
      const group = createNetworkAccessGroupFixture({ version: 7 })
      seedNetworkAccessGroups(queryClient, { groups: [group] })
      let resolveDeletion!: (response: Response) => void
      const deletion = new Promise<Response>((resolve) => {
        resolveDeletion = resolve
      })
      const deleteRequests: Request[] = []
      vi.mocked(globalThis.fetch).mockImplementation(async (input, init) => {
        const request = input instanceof Request ? input : new Request(String(input), init)
        if (request.method === 'DELETE') {
          deleteRequests.push(request)
          return deletion
        }
        return new Response(JSON.stringify({ groups: [], entitled: true }), {
          headers: { 'content-type': 'application/json' },
        })
      })
      renderWithConsoleQuery(
        <NuqsTestingAdapter>
          <IpPoliciesPage />
        </NuqsTestingAdapter>,
        { queryClient, systemFeatures: { deployment_edition: 'CLOUD' } },
      )

      await user.click(screen.getByRole('button', { name: 'More actions for Internal Network' }))
      await user.click(screen.getByRole('menuitem', { name: 'Delete' }))
      const dialog = screen.getByRole('alertdialog', { name: 'Delete “Internal Network”?' })
      const deleteButton = within(dialog).getByRole('button', { name: 'Delete' })
      await user.click(deleteButton)

      await waitFor(() => expect(deleteButton).toHaveAttribute('aria-disabled', 'true'))
      expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled()
      expect(within(dialog).getByRole('button', { name: 'Close' })).toBeDisabled()
      await user.click(deleteButton)
      await user.keyboard('{Escape}')
      expect(dialog).toBeInTheDocument()
      expect(deleteRequests).toHaveLength(1)
      expect(deleteRequests[0]?.url).toContain('group-1?expected_version=7')

      await act(async () => {
        resolveDeletion(
          succeeds
            ? new Response(null, { status: 204 })
            : new Response(JSON.stringify({ message: 'Unable to delete policy' }), {
                status: 500,
                headers: { 'content-type': 'application/json' },
              }),
        )
      })

      if (succeeds) {
        await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
        expect(screen.queryByRole('button', { name: 'Internal Network' })).not.toBeInTheDocument()
      } else {
        await waitFor(() => expect(deleteButton).not.toHaveAttribute('aria-disabled', 'true'))
        expect(dialog).toBeInTheDocument()
        expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeEnabled()
        await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
        await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
        expect(screen.getByRole('button', { name: 'Internal Network' })).toBeInTheDocument()
      }
    },
  )

  it.each(['owner', 'admin'] as const)(
    'opens edit directly from the policy row for %s',
    async (role) => {
      const user = userEvent.setup()
      const queryClient = createConsoleQueryClient()
      seedNetworkAccessGroups(queryClient, { groups: [createNetworkAccessGroupFixture()] })
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
      await user.click(screen.getByRole('button', { name: 'Internal Network' }))
      expect(screen.getByRole('dialog', { name: 'Edit IP Policy' })).toBeInTheDocument()
      expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Internal Network')
      await user.keyboard('{Escape}')
      await user.click(screen.getByRole('button', { name: 'More actions for Internal Network' }))
      expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument()
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    },
  )

  it.each([0, 1])(
    'shows total references under Used by even when only %s apps enforce the policy',
    (enforcingCount) => {
      const queryClient = createConsoleQueryClient()
      seedNetworkAccessGroups(queryClient, {
        groups: [
          createNetworkAccessGroupFixture({ used_by_count: 2, enforcing_count: enforcingCount }),
        ],
      })
      renderWithConsoleQuery(
        <NuqsTestingAdapter>
          <IpPoliciesPage />
        </NuqsTestingAdapter>,
        {
          queryClient,
          systemFeatures: { deployment_edition: 'CLOUD' },
        },
      )
      expect(screen.getByText('Used by')).toBeInTheDocument()
      expect(
        within(screen.getByRole('button', { name: 'Internal Network' })).getByText('2 apps'),
      ).toBeInTheDocument()
      expect(screen.queryByText('Enforcing')).not.toBeInTheDocument()
    },
  )

  it.each(['view', 'edit', 'delete'] as const)(
    'links agent and regular app references correctly in %s',
    async (mode) => {
      const user = userEvent.setup()
      const queryClient = createConsoleQueryClient()
      seedNetworkAccessGroups(queryClient, {
        groups: [
          createNetworkAccessGroupFixture({
            used_by_count: 2,
            enforcing_count: 1,
            apps: [
              {
                id: 'backing-app',
                bound_agent_id: 'agent-1',
                name: 'New Agent',
                mode: 'workflow',
                icon: null,
                icon_type: null,
                icon_background: null,
              },
              {
                id: 'app-2',
                name: 'Workflow',
                mode: 'workflow',
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
          currentWorkspace: { role: mode === 'view' ? 'editor' : 'owner' },
          systemFeatures: { deployment_edition: 'CLOUD' },
        },
      )
      if (mode === 'delete') {
        await user.click(screen.getByRole('button', { name: 'More actions for Internal Network' }))
        await user.click(screen.getByRole('menuitem', { name: 'Delete' }))
        expect(screen.getByText('Still used by 2 apps')).toBeInTheDocument()
      } else {
        await user.click(screen.getByRole('button', { name: 'Internal Network' }))
      }
      expect(screen.getByRole('link', { name: 'New Agent' })).toHaveAttribute(
        'href',
        '/agents/agent-1/configure',
      )
      expect(screen.getByRole('link', { name: 'New Agent' })).toHaveAttribute('target', '_blank')
      expect(screen.getByRole('link', { name: 'Workflow' })).toHaveAttribute(
        'href',
        '/app/app-2/overview',
      )
    },
  )
})
