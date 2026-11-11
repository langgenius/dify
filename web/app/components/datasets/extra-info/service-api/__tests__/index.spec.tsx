import { QueryClientProvider } from '@tanstack/react-query'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '@/test/console/render'
import { createTestQueryClient } from '@/test/query-client'
import { ServiceApi } from '../index'

let mockPermissionKeys = ['dataset.api_key.manage']

vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')

  return createPermissionStateModuleMock(() => ({
    workspacePermissionKeys: mockPermissionKeys,
  }))
})

vi.mock('@/service/console/browser', () => ({
  consoleBrowserLink: {
    call: async (path: string[]) => {
      if (path.join('.') === 'datasets.apiKeys.get') return { data: [] }
      throw new Error(`Unexpected API call: ${path.join('.')}`)
    },
  },
}))
vi.mock('@/context/workspace-state', async () => {
  const { createWorkspaceStateModuleMock } = await import('@/test/console/state-fixture')
  return createWorkspaceStateModuleMock(() => ({ currentWorkspace: { id: 'workspace-1' } }))
})

vi.mock('@/hooks/use-api-access-url', () => ({
  useDatasetApiAccessUrl: () => 'https://docs.dify.ai/api-reference/datasets',
}))

describe('ServiceApi', () => {
  beforeEach(() => {
    mockPermissionKeys = ['dataset.api_key.manage']
  })

  it('opens secret-key management from the service API details', async () => {
    const user = userEvent.setup()
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <ServiceApi apiBaseUrl="https://api.example.com" />
      </QueryClientProvider>,
    )

    const trigger = screen.getByRole('button', { name: 'dataset.serviceApi.title' })
    expect(trigger).not.toHaveAttribute('data-popup-open')

    await user.click(trigger)

    expect(screen.getByText('https://api.example.com')).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'dataset.serviceApi.card.apiReference' }),
    ).toHaveAttribute('href', 'https://docs.dify.ai/api-reference/datasets')
    await user.click(screen.getByRole('button', { name: 'dataset.serviceApi.card.apiKey' }))

    const dialog = await screen.findByRole('dialog', { name: 'appApi.apiKeyModal.apiSecretKey' })
    expect(dialog).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'common.operation.close' }))
    expect(trigger).toHaveFocus()
  })

  it('prevents secret-key management without workspace permission', async () => {
    const user = userEvent.setup()
    mockPermissionKeys = []
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <ServiceApi apiBaseUrl="https://api.example.com" />
      </QueryClientProvider>,
    )

    await user.click(screen.getByRole('button', { name: 'dataset.serviceApi.title' }))

    expect(screen.getByRole('button', { name: 'dataset.serviceApi.card.apiKey' })).toBeDisabled()
    expect(
      screen.queryByRole('dialog', { name: 'appApi.apiKeyModal.apiSecretKey' }),
    ).not.toBeInTheDocument()
  })
})
