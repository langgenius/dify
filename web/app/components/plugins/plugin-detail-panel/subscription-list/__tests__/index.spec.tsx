import type { ComponentProps } from 'react'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { usePluginStore } from '../../store'
import { SubscriptionList } from '../index'
import { SubscriptionListMode } from '../types'

const list = vi.hoisted(() => vi.fn())
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'workspaces.current.triggerProvider.byProvider.subscriptions.list.get': list,
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
function renderList(ui = <SubscriptionList />) {
  // This area owns a singleton Zustand store; seed before mounting, reset by Vitest setup.
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
  return renderWithConsoleQuery(ui, { queryClient })
}
it('shows loading until the real provider subscription query supplies its cards', async () => {
  const pending = createDeferred<(typeof subscription)[]>()
  list.mockReturnValueOnce(pending.promise)
  renderList()
  expect(screen.getByRole('progressbar')).toBeInTheDocument()
  expect(screen.queryByText('Subscription One')).not.toBeInTheDocument()
  await act(async () => pending.resolve([subscription]))
  expect(await screen.findByText('Subscription One')).toBeInTheDocument()
  expect(screen.getByText(/pluginTrigger.subscription.listNum/)).toBeInTheDocument()
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  expect(list).toHaveBeenCalledWith({ params: { provider: 'provider-1' } })
})
it('omits the list header and cards for an empty response', async () => {
  list.mockResolvedValueOnce([])
  renderList()
  await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument())
  expect(screen.queryByText(/pluginTrigger.subscription.listNum/)).not.toBeInTheDocument()
  expect(screen.queryByText('Subscription One')).not.toBeInTheDocument()
})
it('selects a subscription and supplies a refresh callback that updates the real list', async () => {
  const user = userEvent.setup()
  list
    .mockResolvedValueOnce([subscription])
    .mockResolvedValue([{ ...subscription, name: 'Updated subscription' }])
  function Caller() {
    const [selected, setSelected] = useState('')
    const [refresh, setRefresh] = useState<() => void>()
    const onSelect: NonNullable<ComponentProps<typeof SubscriptionList>['onSelect']> = (
      value,
      callback,
    ) => {
      setSelected(`${value.id}: ${value.name}`)
      setRefresh(() => callback)
    }
    return (
      <>
        <output aria-label="Selected subscription">{selected}</output>
        <button type="button" onClick={() => refresh?.()}>
          Refresh subscriptions
        </button>
        <SubscriptionList mode={SubscriptionListMode.SELECTOR} onSelect={onSelect} />
      </>
    )
  }
  renderList(<Caller />)
  await user.click(await screen.findByRole('button', { name: 'Subscription One' }))
  expect(screen.getByLabelText('Selected subscription')).toHaveTextContent(
    'sub-1: Subscription One',
  )
  await user.click(screen.getByRole('button', { name: 'Refresh subscriptions' }))
  expect(await screen.findByRole('button', { name: 'Updated subscription' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Subscription One' })).not.toBeInTheDocument()
})
