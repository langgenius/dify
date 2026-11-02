import type { ContactView } from '../types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import { consoleClient } from '@/service/console'
import { ContactsManagementProvider } from '../composition'
import { ContactDetailsPanel } from '../contact-details-panel'
import { createContactsApiRepository } from '../repository'
import { ContactsMockScenario, createContactsMockScenario } from './fixtures/scenarios'

vi.mock('@/service/console', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/console')>()),
  consoleClient: {
    workspaces: {
      current: {
        humanInput: { v2: { channels: { get: vi.fn() } } },
      },
    },
  },
}))

function renderContact(imCentrallyManaged: boolean, bound: boolean) {
  const scenario = createContactsMockScenario(ContactsMockScenario.EeMixed)
  const contact: ContactView = {
    id: 'contact-member',
    type: 'workspace',
    name: 'Workspace Member',
    email: 'member@example.com',
    avatar_url: '',
    created_at: 1,
    im_bindings: bound ? [{ id: 'binding-feishu', provider: 'feishu', scope: 'organization' }] : [],
  }
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <ContactsManagementProvider
        context={{
          deployment: scenario.deployment,
          imCentrallyManaged,
          permissions: scenario.permissions,
          workspaceId: scenario.workspaceId,
        }}
        repository={createContactsApiRepository()}
      >
        <ContactDetailsPanel
          contact={contact}
          onClose={vi.fn()}
          onEdit={vi.fn()}
          onRemove={vi.fn()}
        />
      </ContactsManagementProvider>
    </QueryClientProvider>,
  )
  return screen.getByRole('complementary', { name: 'contacts.details.title' })
}

describe('Contact details IM channel availability', () => {
  const channels = consoleClient.workspaces.current.humanInput.v2.channels

  beforeEach(() => vi.resetAllMocks())

  it.each([false, true])(
    'does not call workspace channel management in centrally managed mode when bound is %s',
    async (bound) => {
      vi.mocked(channels.get).mockRejectedValue(
        Object.assign(new Error('Workspace channel management is unavailable'), { status: 501 }),
      )

      const details = renderContact(true, bound)
      await waitFor(() => {
        expect(
          within(details).getByText('contacts.imBinding.enterpriseReadOnly'),
        ).toBeInTheDocument()
        expect(within(details).queryByRole('alert')).not.toBeInTheDocument()
      })

      expect(channels.get).not.toHaveBeenCalled()
      expect(
        within(details).queryByRole('button', { name: 'contacts.imBinding.bind' }),
      ).not.toBeInTheDocument()
      if (bound) {
        expect(within(details).getByText('Feishu')).toBeInTheDocument()
        expect(
          within(details).getByRole('button', { name: /^contacts\.imBinding\.changeTitle/ }),
        ).toBeEnabled()
      } else {
        expect(within(details).queryByText('Feishu')).not.toBeInTheDocument()
      }
    },
  )

  it('still discovers configured IM channels and offers initial binding in workspace-managed mode', async () => {
    vi.mocked(channels.get).mockResolvedValue({
      channels: [
        {
          id: 'channel-feishu',
          kind: 'im',
          provider: 'feishu',
          config_version: 'version-1',
          created_at: 1,
          updated_at: 1,
          display_identifier: 'feishu-app',
          status: 'configured',
          status_description: '',
          webhook_url: null,
        },
      ],
    })

    const details = renderContact(false, false)

    expect(
      await within(details).findByRole('button', { name: 'contacts.imBinding.bind' }),
    ).toBeEnabled()
    expect(within(details).getByText('Feishu')).toBeInTheDocument()
    expect(channels.get).toHaveBeenCalledExactlyOnceWith(undefined, { context: { silent: true } })
  })
})
