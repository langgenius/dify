import type { GetFeaturesResponse } from '@dify/contracts/api/console/features/types.gen'
import { zGetFeaturesResponse } from '@dify/contracts/api/console/features/zod.gen'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createStore, Provider } from 'jotai'
import { queryClientAtom } from 'jotai-tanstack-query'
import { consoleQuery } from '@/service/console'
import { createSystemFeaturesFixture } from '@/test/console/system-features'
import { ContactsManagementRuntimeProvider } from '../composition'
import { useContactsFeatureContext } from '../composition-context'

const service = vi.hoisted(() => ({
  getFeatures: vi.fn<() => Promise<GetFeaturesResponse>>(),
}))

vi.mock('@/service/console', async () => {
  const { createTanstackQueryUtils } = await import('@orpc/tanstack-query')
  return {
    consoleQuery: createTanstackQueryUtils({
      features: { get: () => service.getFeatures() },
      systemFeatures: { get: async () => createSystemFeaturesFixture() },
      workspaces: {
        current: {
          summary: {
            get: async () => ({
              id: 'workspace-1',
              name: 'Workspace',
              plan: null,
              role: 'owner',
              credits: null,
            }),
          },
        },
      },
    }),
  }
})

vi.mock('../repository', () => ({
  createContactsApiRepository: () => ({}),
}))

function CapabilityProbe() {
  const context = useContactsFeatureContext()
  return (
    <>
      <output aria-label="Contacts management capability">
        {context.imBindingCentrallyManaged === undefined
          ? 'Loading capabilities'
          : context.imBindingCentrallyManaged
            ? 'Centrally managed'
            : 'Workspace managed'}
      </output>
      {context.imBindingCapabilityError && (
        <>
          <p role="alert">{context.imBindingCapabilityError.message}</p>
          <button type="button" onClick={context.retryIMBindingCapability}>
            Retry capabilities
          </button>
        </>
      )}
    </>
  )
}

function renderRuntime(deploymentEdition: 'COMMUNITY' | 'ENTERPRISE') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  queryClient.setQueryData(
    consoleQuery.systemFeatures.get.queryKey(),
    createSystemFeaturesFixture({
      deployment_edition: deploymentEdition,
    }),
  )
  queryClient.setQueryData(consoleQuery.workspaces.current.summary.get.queryKey(), {
    id: 'workspace-1',
    name: 'Workspace',
    plan: null,
    role: 'owner',
    credits: null,
  })
  const store = createStore()
  store.set(queryClientAtom, queryClient)

  render(
    <QueryClientProvider client={queryClient}>
      <Provider store={store}>
        <ContactsManagementRuntimeProvider>
          <p>Home content</p>
          <CapabilityProbe />
        </ContactsManagementRuntimeProvider>
      </Provider>
    </QueryClientProvider>,
  )
}

describe('ContactsManagementRuntimeProvider capability', () => {
  beforeEach(() => {
    service.getFeatures.mockReset()
  })

  it.each([
    { edition: 'COMMUNITY' as const, managed: true, expected: 'Centrally managed' },
    { edition: 'ENTERPRISE' as const, managed: false, expected: 'Workspace managed' },
  ])(
    'uses features rather than $edition edition when centrally managed is $managed',
    async ({ edition, managed, expected }) => {
      const features = {
        ...zGetFeaturesResponse.parse({}),
        im_binding_centrally_managed: managed,
      }
      service.getFeatures.mockResolvedValue(features)

      renderRuntime(edition)

      await waitFor(() =>
        expect(screen.getByLabelText('Contacts management capability')).toHaveTextContent(expected),
      )
      expect(service.getFeatures).toHaveBeenCalledOnce()
    },
  )

  it('keeps normal page content available without treating pending capabilities as workspace-managed', async () => {
    let resolveFeatures: ((features: GetFeaturesResponse) => void) | undefined
    service.getFeatures.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFeatures = resolve
        }),
    )

    renderRuntime('ENTERPRISE')

    expect(screen.getByText('Home content')).toBeInTheDocument()
    expect(screen.getByLabelText('Contacts management capability')).toHaveTextContent(
      'Loading capabilities',
    )
    await act(async () => resolveFeatures?.(zGetFeaturesResponse.parse({})))

    await waitFor(() =>
      expect(screen.getByLabelText('Contacts management capability')).toHaveTextContent(
        'Workspace managed',
      ),
    )
  })

  it('keeps normal content mounted after a features failure and retries without authorizing a fallback mode', async () => {
    const user = userEvent.setup()
    service.getFeatures.mockRejectedValueOnce(new Error('Capabilities unavailable'))
    renderRuntime('COMMUNITY')

    expect(await screen.findByRole('alert')).toHaveTextContent('Capabilities unavailable')
    expect(screen.getByText('Home content')).toBeInTheDocument()
    expect(screen.getByLabelText('Contacts management capability')).toHaveTextContent(
      'Loading capabilities',
    )

    const features = { ...zGetFeaturesResponse.parse({}), im_binding_centrally_managed: true }
    service.getFeatures.mockResolvedValue(features)
    await user.click(screen.getByRole('button', { name: 'Retry capabilities' }))

    await waitFor(() =>
      expect(screen.getByLabelText('Contacts management capability')).toHaveTextContent(
        'Centrally managed',
      ),
    )
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(service.getFeatures).toHaveBeenCalledTimes(2)
  })
})
