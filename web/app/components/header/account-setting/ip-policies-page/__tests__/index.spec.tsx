import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { initReactI18next } from 'react-i18next'
import { trackEvent } from '@/app/components/base/amplitude'
import commonTranslations from '@/i18n/locales/en-US/common.json'
import deploymentTranslations from '@/i18n/locales/en-US/deployments.json'
import { seedCurrentWorkspaceQuery } from '@/test/console/current-workspace'
import {
  createNetworkAccessGroupFixture,
  seedNetworkAccessGroups,
} from '@/test/console/network-access'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import IpPoliciesPage from '..'

vi.unmock('react-i18next')
vi.mock('@/app/components/base/amplitude', () => ({ trackEvent: vi.fn() }))

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
      expect(trackEvent).toHaveBeenCalledWith('ip_policy_interaction', {
        action: 'settings_tab_viewed',
      })
      expect(trackEvent).toHaveBeenCalledWith('ip_policy_interaction', {
        action: 'form_opened',
        mode: 'view',
        source: 'list_row',
        policy_id: 'group-1',
      })
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

  it('reloads a conflicting policy from the server before another save', async () => {
    const user = userEvent.setup()
    const original = createNetworkAccessGroupFixture({ version: 1 })
    const remote = createNetworkAccessGroupFixture({ name: 'Allow-Remote', version: 2 })
    const queryClient = createConsoleQueryClient()
    seedNetworkAccessGroups(queryClient, { groups: [original] })
    const requests: Request[] = []
    const putBodies: unknown[] = []
    vi.mocked(globalThis.fetch).mockImplementation(async (input, init) => {
      const request = input instanceof Request ? input : new Request(String(input), init)
      requests.push(request)
      if (request.url.endsWith('/current-ip')) return Response.json({ client_ip: '203.0.113.42' })
      if (request.method === 'GET')
        return Response.json({ tenant_id: 'workspace-1', entitled: true, groups: [remote] })
      putBodies.push(JSON.parse(await request.clone().text()))
      if (requests.filter((item) => item.method === 'PUT').length === 1)
        return Response.json({ code: 'network_access_conflict' }, { status: 409 })
      return Response.json({ group: remote, entitled: true })
    })
    renderWithConsoleQuery(
      <NuqsTestingAdapter>
        <IpPoliciesPage />
      </NuqsTestingAdapter>,
      { queryClient, systemFeatures: { deployment_edition: 'CLOUD' } },
    )

    await user.click(screen.getByRole('button', { name: 'Internal Network' }))
    await user.clear(screen.getByRole('textbox', { name: 'Name' }))
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Allow-Local')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Allow-Remote'),
    )
    expect(
      requests.filter(
        (request) => request.method === 'GET' && !request.url.endsWith('/current-ip'),
      ),
    ).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Allow-Remote' }))
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Allow-Remote')
    await user.clear(screen.getByRole('textbox', { name: 'Name' }))
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Confirmed')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(requests.filter((request) => request.method === 'PUT')).toHaveLength(2),
    )
    expect(putBodies[1]).toMatchObject({
      name: 'Confirmed',
      expected_version: 2,
    })
  })

  it('accumulates all validation errors through a conflict retry and resets them on reopen', async () => {
    const user = userEvent.setup()
    const group = createNetworkAccessGroupFixture({ allowed_cidrs: ['10.0.0.0/8'] })
    const queryClient = createConsoleQueryClient()
    seedNetworkAccessGroups(queryClient, { groups: [group] })
    let saves = 0
    vi.mocked(globalThis.fetch).mockImplementation(async (input, init) => {
      const request = new Request(input, init)
      if (request.url.endsWith('/current-ip')) return Response.json({ client_ip: '203.0.113.42' })
      if (request.method === 'PUT') {
        saves += 1
        return saves === 1
          ? Response.json({ code: 'network_access_conflict' }, { status: 409 })
          : Response.json({ group, entitled: true })
      }
      return Response.json({
        tenant_id: 'workspace-1',
        entitled: true,
        groups: [{ ...group, version: 2 }],
      })
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
    await user.click(screen.getByRole('button', { name: 'Internal Network' }))
    const entry = screen.getByPlaceholderText('10.0.0.0/8')
    for (const invalid of [
      '256.1.1.1',
      '01.1.1.1',
      'gg::1',
      '10.0.0.1/x',
      '10.0.0.1/33',
      '10.0.0.1/1/2',
      'invalid',
      '256.1.1.1',
    ]) {
      await user.clear(entry)
      await user.paste(invalid)
      expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    }
    await user.clear(entry)
    await user.paste('10.0.0.0/8')
    const validationErrors = [
      'octet_out_of_range',
      'leading_zero',
      'invalid_ipv6',
      'prefix_not_number',
      'prefix_out_of_range',
      'multiple_slash',
      'unsupported_format',
    ]
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(trackEvent).toHaveBeenCalledWith('ip_policy_save', {
        mode: 'edit',
        source: 'list_row',
        policy_id: 'group-1',
        entry_count: 1,
        validation_error_types: validationErrors,
        result: 'failed',
        fail_reason: 'other',
      }),
    )
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save' })).not.toHaveAttribute(
        'aria-disabled',
        'true',
      ),
    )
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(trackEvent).toHaveBeenCalledWith('ip_policy_save', {
        mode: 'edit',
        source: 'list_row',
        policy_id: 'group-1',
        entry_count: 1,
        validation_error_types: validationErrors,
        result: 'success',
      }),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Internal Network' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(trackEvent).toHaveBeenCalledWith('ip_policy_save', {
        mode: 'edit',
        source: 'list_row',
        policy_id: 'group-1',
        entry_count: 1,
        validation_error_types: [],
        result: 'success',
      }),
    )
    expect(
      vi.mocked(trackEvent).mock.calls.filter(([event]) => event === 'ip_policy_save'),
    ).toHaveLength(3)
    expect(
      vi.mocked(trackEvent).mock.calls.filter(([, props]) => props?.action === 'form_opened'),
    ).toHaveLength(2)
  })

  it('offers a retry when conflict recovery cannot reload the policy', async () => {
    const user = userEvent.setup()
    const original = createNetworkAccessGroupFixture({ version: 1 })
    const remote = createNetworkAccessGroupFixture({ name: 'Allow-Remote', version: 2 })
    const queryClient = createConsoleQueryClient()
    seedNetworkAccessGroups(queryClient, { groups: [original] })
    let getCount = 0
    vi.mocked(globalThis.fetch).mockImplementation(async (input, init) => {
      const request = input instanceof Request ? input : new Request(String(input), init)
      if (request.url.endsWith('/current-ip')) return Response.json({ client_ip: '203.0.113.42' })
      if (request.method === 'GET') {
        getCount += 1
        return getCount === 1
          ? Response.json({ message: 'Unavailable' }, { status: 500 })
          : Response.json({ tenant_id: 'workspace-1', entitled: true, groups: [remote] })
      }
      return Response.json({ code: 'network_access_conflict' }, { status: 409 })
    })
    renderWithConsoleQuery(
      <NuqsTestingAdapter>
        <IpPoliciesPage />
      </NuqsTestingAdapter>,
      { queryClient, systemFeatures: { deployment_edition: 'CLOUD' } },
    )

    await user.click(screen.getByRole('button', { name: 'Internal Network' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load')
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Try Again' }))
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Allow-Remote'),
    )
    expect(getCount).toBe(2)
  })

  it('does not replace another edit session with a late conflict response', async () => {
    const user = userEvent.setup()
    const original = createNetworkAccessGroupFixture({ version: 1 })
    const other = createNetworkAccessGroupFixture({ id: 'group-2', name: 'Other Policy' })
    const remote = createNetworkAccessGroupFixture({ name: 'Allow-Remote', version: 2 })
    const queryClient = createConsoleQueryClient()
    seedNetworkAccessGroups(queryClient, { groups: [original, other] })
    let resolveReload!: (response: Response) => void
    const reload = new Promise<Response>((resolve) => {
      resolveReload = resolve
    })
    vi.mocked(globalThis.fetch).mockImplementation(async (input, init) => {
      const request = input instanceof Request ? input : new Request(String(input), init)
      if (request.url.endsWith('/current-ip')) return Response.json({ client_ip: '203.0.113.42' })
      return request.method === 'GET'
        ? reload
        : Response.json({ code: 'network_access_conflict' }, { status: 409 })
    })
    renderWithConsoleQuery(
      <NuqsTestingAdapter>
        <IpPoliciesPage />
      </NuqsTestingAdapter>,
      { queryClient, systemFeatures: { deployment_edition: 'CLOUD' } },
    )

    await user.click(screen.getByRole('button', { name: 'Internal Network' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('aria-disabled', 'true'),
    )
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Other Policy' }))
    await act(async () => {
      resolveReload(
        Response.json({ tenant_id: 'workspace-1', entitled: true, groups: [remote, other] }),
      )
    })
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Other Policy')
  })

  it.each(['create_empty', 'create', 'edit', 'delete'] as const)(
    'stops %s when manager permission is revoked',
    async (action) => {
      const user = userEvent.setup()
      const queryClient = createConsoleQueryClient()
      seedNetworkAccessGroups(queryClient, {
        groups: action === 'create_empty' ? [] : [createNetworkAccessGroupFixture()],
      })
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

      if (action === 'create' || action === 'create_empty') {
        await user.click(
          screen.getByRole('button', {
            name: action === 'create_empty' ? 'Create an IP policy' : 'Add',
          }),
        )
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
          screen.queryByRole('button', { name: 'Create an IP policy' }),
        ).not.toBeInTheDocument()
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

  it.each(['owner', 'admin'] as const)(
    'opens a fresh empty-state form for %s on each visit',
    async (role) => {
      const user = userEvent.setup()
      const queryClient = createConsoleQueryClient()
      seedNetworkAccessGroups(queryClient, { entitled: true, groups: [] })
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

      expect(
        screen.getByRole('heading', { name: 'No IP policies in this workspace yet' }),
      ).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Add' })).not.toBeInTheDocument()
      await user.tab()
      expect(screen.getByRole('button', { name: 'Create an IP policy' })).toHaveFocus()
      await user.keyboard('{Enter}')
      expect(screen.getByRole('heading', { name: 'New IP Policy' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled()
      expect(vi.mocked(trackEvent).mock.calls).toEqual([
        ['ip_policy_interaction', { action: 'settings_tab_viewed' }],
        [
          'ip_policy_interaction',
          { action: 'form_opened', mode: 'create', source: 'list_empty_state' },
        ],
      ])

      await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Unsaved policy')
      await user.click(screen.getByRole('button', { name: 'Cancel' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      await user.click(screen.getByRole('button', { name: 'Create an IP policy' }))
      expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('')
      expect(vi.mocked(trackEvent).mock.calls).toEqual([
        ['ip_policy_interaction', { action: 'settings_tab_viewed' }],
        [
          'ip_policy_interaction',
          { action: 'form_opened', mode: 'create', source: 'list_empty_state' },
        ],
        [
          'ip_policy_interaction',
          { action: 'form_opened', mode: 'create', source: 'list_empty_state' },
        ],
      ])
    },
  )

  it.each(['list_empty_state', 'list_add_button'] as const)(
    'creates a policy from %s and refreshes the list',
    async (source) => {
      const user = userEvent.setup()
      const initialGroups = source === 'list_add_button' ? [createNetworkAccessGroupFixture()] : []
      const created = createNetworkAccessGroupFixture({ id: 'new-group', name: 'Office' })
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
        if (request.method === 'POST')
          return Response.json({ group: created, entitled: true }, { status: 201 })
        if (new URL(request.url).pathname.endsWith('/network-access-groups'))
          return Response.json({
            tenant_id: 'workspace-1',
            entitled: true,
            groups: [...initialGroups, created],
          })
        return Response.json({ client_ip: '203.0.113.42' })
      })
      const queryClient = createConsoleQueryClient()
      seedNetworkAccessGroups(queryClient, { entitled: true, groups: initialGroups })
      renderWithConsoleQuery(
        <NuqsTestingAdapter>
          <IpPoliciesPage />
        </NuqsTestingAdapter>,
        { queryClient, systemFeatures: { deployment_edition: 'CLOUD' } },
      )

      await user.click(
        screen.getByRole('button', {
          name: source === 'list_empty_state' ? 'Create an IP policy' : 'Add',
        }),
      )
      await user.type(screen.getByPlaceholderText('e.g. Internal Network'), 'Office')
      await user.click(screen.getByPlaceholderText('10.0.0.0/8'))
      await user.paste('10.0.0.0/8')
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
      expect(await screen.findByRole('button', { name: 'Office' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument()
      expect(
        screen.queryByRole('heading', { name: 'No IP policies in this workspace yet' }),
      ).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Create an IP policy' })).not.toBeInTheDocument()
      expect(trackEvent).toHaveBeenCalledWith('ip_policy_interaction', {
        action: 'form_opened',
        mode: 'create',
        source,
      })
      await waitFor(() =>
        expect(trackEvent).toHaveBeenCalledWith('ip_policy_save', {
          mode: 'create',
          source,
          result: 'success',
          policy_id: created.id,
          entry_count: 1,
          validation_error_types: [],
        }),
      )
    },
  )

  it('keeps the empty-state source and validation history through a failed creation and retry', async () => {
    const user = userEvent.setup()
    const created = createNetworkAccessGroupFixture({ name: 'Office' })
    let attempts = 0
    vi.mocked(globalThis.fetch).mockImplementation(async (input, init) => {
      const request = input instanceof Request ? input : new Request(String(input), init)
      if (request.method === 'POST') {
        attempts += 1
        return attempts === 1
          ? Response.json({ message: 'Unavailable' }, { status: 503 })
          : Response.json({ group: created, entitled: true }, { status: 201 })
      }
      if (new URL(request.url).pathname.endsWith('/network-access-groups'))
        return Response.json({ tenant_id: 'workspace-1', entitled: true, groups: [created] })
      return Response.json({ client_ip: '203.0.113.42' })
    })
    const queryClient = createConsoleQueryClient()
    seedNetworkAccessGroups(queryClient)
    renderWithConsoleQuery(
      <NuqsTestingAdapter>
        <IpPoliciesPage />
      </NuqsTestingAdapter>,
      { queryClient, systemFeatures: { deployment_edition: 'CLOUD' } },
    )

    await user.click(screen.getByRole('button', { name: 'Create an IP policy' }))
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Office')
    const entry = screen.getByPlaceholderText('10.0.0.0/8')
    await user.click(entry)
    await user.paste('999.0.0.1')
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled()
    await user.clear(entry)
    await user.paste('10.0.0.0/8')
    await user.click(screen.getByRole('button', { name: 'Create' }))

    const analytics = {
      mode: 'create',
      source: 'list_empty_state',
      entry_count: 1,
      validation_error_types: ['octet_out_of_range'],
    }
    await waitFor(() =>
      expect(trackEvent).toHaveBeenCalledWith('ip_policy_save', {
        ...analytics,
        result: 'failed',
        fail_reason: 'network',
      }),
    )
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Office')
    expect(entry).toHaveValue('10.0.0.0/8')
    await user.click(screen.getByRole('button', { name: 'Create' }))
    await waitFor(() =>
      expect(
        vi.mocked(trackEvent).mock.calls.filter(([event]) => event === 'ip_policy_save'),
      ).toEqual([
        ['ip_policy_save', { ...analytics, result: 'failed', fail_reason: 'network' }],
        ['ip_policy_save', { ...analytics, result: 'success', policy_id: created.id }],
      ]),
    )
    expect(
      vi
        .mocked(trackEvent)
        .mock.calls.filter(([, properties]) => properties?.action === 'form_opened'),
    ).toHaveLength(1)
  })

  it('keeps empty-state creation unavailable to editors', () => {
    const queryClient = createConsoleQueryClient()
    seedNetworkAccessGroups(queryClient)
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

    expect(
      screen.getByRole('heading', { name: 'No IP policies in this workspace yet' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Create an IP policy' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add' })).not.toBeInTheDocument()
    expect(trackEvent).toHaveBeenCalledExactlyOnceWith('ip_policy_interaction', {
      action: 'settings_tab_viewed',
    })
  })

  it('opens pricing without reporting a form when the empty workspace is not entitled', async () => {
    const user = userEvent.setup()
    const onUrlUpdate = vi.fn()
    const queryClient = createConsoleQueryClient()
    seedNetworkAccessGroups(queryClient, { entitled: false })
    renderWithConsoleQuery(
      <NuqsTestingAdapter onUrlUpdate={onUrlUpdate}>
        <IpPoliciesPage />
      </NuqsTestingAdapter>,
      { queryClient, systemFeatures: { deployment_edition: 'CLOUD' } },
    )

    await user.click(screen.getByRole('button', { name: 'Create an IP policy' }))
    await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled())
    expect(onUrlUpdate.mock.lastCall?.[0].searchParams.get('pricing')).toBe('open')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trackEvent).toHaveBeenCalledExactlyOnceWith('ip_policy_interaction', {
      action: 'settings_tab_viewed',
    })
  })

  it('does not show the empty state while policies are loading or when the request fails', async () => {
    let resolveGroups!: (response: Response) => void
    vi.mocked(globalThis.fetch).mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveGroups = resolve
      }),
    )
    renderWithConsoleQuery(
      <NuqsTestingAdapter>
        <IpPoliciesPage />
      </NuqsTestingAdapter>,
      { systemFeatures: { deployment_edition: 'CLOUD' } },
    )

    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: 'No IP policies in this workspace yet' }),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Create an IP policy' })).not.toBeInTheDocument()
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled())
    await act(async () => {
      resolveGroups(Response.json({ message: 'Unavailable' }, { status: 503 }))
    })
    expect(await screen.findByText(deploymentTranslations['common.loadFailed'])).toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: 'No IP policies in this workspace yet' }),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Create an IP policy' })).not.toBeInTheDocument()
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

      expect(
        vi
          .mocked(trackEvent)
          .mock.calls.filter(([, props]) => String(props?.action).startsWith('delete_')),
      ).toEqual([
        ['ip_policy_interaction', { action: 'delete_attempted', policy_id: 'group-1' }],
        ...(button === 'Cancel'
          ? [['ip_policy_interaction', { action: 'delete_cancelled', policy_id: 'group-1' }]]
          : []),
      ])

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
      const group = createNetworkAccessGroupFixture({ version: 7, used_by_count: 2 })
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
      expect(
        vi
          .mocked(trackEvent)
          .mock.calls.filter(([, props]) => String(props?.action).startsWith('delete_')),
      ).toEqual([
        ['ip_policy_interaction', { action: 'delete_attempted', policy_id: 'group-1' }],
        [
          'ip_policy_interaction',
          { action: 'delete_confirmed', policy_id: 'group-1', referenced_app_count: 2 },
        ],
      ])

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
