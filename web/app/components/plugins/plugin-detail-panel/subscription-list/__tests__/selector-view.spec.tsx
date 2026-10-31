import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { usePluginStore } from '../../store'
import { SubscriptionSelectorView } from '../selector-view'

const requests = vi.hoisted(() => ({ list: vi.fn(), remove: vi.fn() }))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'workspaces.current.triggerProvider.byProvider.subscriptions.list.get': requests.list,
      'workspaces.current.triggerProvider.bySubscriptionId.subscriptions.delete.post':
        requests.remove,
    }),
  }
})

const subscription = {
  id: 'sub-1',
  name: 'Subscription One',
  provider: 'provider-1',
  credential_type: 'api-key',
  credentials: {},
  endpoint: 'https://example.com',
  parameters: {},
  properties: {},
  workflows_in_use: 0,
}
function Caller({ initiallySelected = false }) {
  const [selected, setSelected] = useState(initiallySelected ? subscription : { id: '', name: '' })
  return (
    <>
      <output aria-label="Selected subscription">
        {selected.id ? `${selected.id}: ${selected.name}` : 'None'}
      </output>
      <SubscriptionSelectorView selectedId={selected.id} onSelect={setSelected} />
    </>
  )
}
function renderSelector(initiallySelected = false) {
  // The area's singleton store is seeded before mount and reset by vitest.setup.ts.
  usePluginStore.setState({
    detail: {
      id: 'plugin-1',
      plugin_id: 'plugin-1',
      name: 'Trigger',
      plugin_unique_identifier: 'plugin-1@1',
      provider: 'provider-1',
      declaration: {},
    },
  })
  const queryClient = createConsoleQueryClient()
  queryClient.setQueryData(
    consoleQuery.workspaces.current.triggerProvider.byProvider.info.get.queryKey({
      input: { params: { provider: 'provider-1' } },
    }),
    {
      author: 'Dify',
      plugin_id: 'plugin-1',
      plugin_unique_identifier: 'plugin-1@1',
      name: 'Trigger',
      label: { en_US: 'Trigger' },
      description: { en_US: 'Trigger provider' },
      supported_creation_methods: [],
      events: [],
      subscription_schema: [],
      subscription_constructor: null,
    },
  )
  return renderWithConsoleQuery(<Caller initiallySelected={initiallySelected} />, { queryClient })
}
beforeEach(() => {
  requests.list.mockReset().mockResolvedValue([subscription])
  requests.remove.mockReset().mockResolvedValue({})
})

it('selects a subscription loaded for the current provider', async () => {
  const user = userEvent.setup()
  renderSelector()
  await user.click(await screen.findByRole('button', { name: 'Subscription One' }))
  expect(screen.getByLabelText('Selected subscription')).toHaveTextContent(
    'sub-1: Subscription One',
  )
  expect(screen.getByText(/pluginTrigger.subscription.listNum/)).toBeInTheDocument()
  expect(requests.list).toHaveBeenCalledWith({ params: { provider: 'provider-1' } })
})
it('omits the header for an empty subscription response', async () => {
  requests.list.mockResolvedValue([])
  const { queryClient } = renderSelector()
  await waitFor(() => expect(queryClient.isFetching()).toBe(0))
  expect(screen.queryByText(/pluginTrigger.subscription.listNum/)).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Subscription One' })).not.toBeInTheDocument()
})
it('removes the deleted subscription from the live list and clears the selection', async () => {
  const user = userEvent.setup()
  requests.list.mockResolvedValueOnce([subscription]).mockResolvedValue([])
  renderSelector(true)
  await screen.findByRole('button', { name: 'Subscription One' })
  await user.click(screen.getByRole('button', { name: 'common.operation.delete' }))
  expect(await screen.findByRole('alertdialog')).toBeInTheDocument()
  expect(screen.getByLabelText('Selected subscription')).toHaveTextContent(
    'sub-1: Subscription One',
  )
  await user.click(screen.getByRole('button', { name: /deleteConfirm.confirm/ }))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: 'Subscription One' })).not.toBeInTheDocument(),
  )
  expect(screen.getByLabelText('Selected subscription')).toHaveTextContent('None')
  expect(requests.remove).toHaveBeenCalledWith({ params: { subscription_id: 'sub-1' } })
})
it('keeps the selection and subscription after cancelling deletion', async () => {
  const user = userEvent.setup()
  renderSelector(true)
  await screen.findByRole('button', { name: 'Subscription One' })
  await user.click(screen.getByRole('button', { name: 'common.operation.delete' }))
  await screen.findByRole('alertdialog')
  await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  expect(screen.getByRole('button', { name: 'Subscription One' })).toBeInTheDocument()
  expect(screen.getByLabelText('Selected subscription')).toHaveTextContent(
    'sub-1: Subscription One',
  )
  expect(requests.remove).not.toHaveBeenCalled()
})
