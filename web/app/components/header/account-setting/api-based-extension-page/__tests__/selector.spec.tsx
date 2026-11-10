import type { ApiBasedExtensionResponse } from '@dify/contracts/api/console/api-based-extension/types.gen'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { renderWithConsoleQuery as renderWithoutUrlState } from '@/test/console/query-data'
import { createNuqsTestRenderer } from '@/test/nuqs-testing'
import { ApiBasedExtensionSelector } from '../selector'

const { listExtensions, mockCreateApiBasedExtension, mockUpdateApiBasedExtension } = vi.hoisted(
  () => ({
    listExtensions: vi.fn(),
    mockCreateApiBasedExtension: vi.fn(),
    mockUpdateApiBasedExtension: vi.fn(),
  }),
)

vi.mock('@/context/i18n', () => ({
  useDocLink:
    () =>
    (path = '') =>
      `https://docs.dify.ai${path}`,
}))

const onUrlUpdate = vi.fn()
const render = createNuqsTestRenderer(renderWithoutUrlState, () => ({ onUrlUpdate }))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'apiBasedExtension.get': listExtensions,
      'apiBasedExtension.post': mockCreateApiBasedExtension,
      'apiBasedExtension.byId.post': mockUpdateApiBasedExtension,
    }),
  }
})

describe('ApiBasedExtensionSelector', () => {
  const mockOnChange = vi.fn()

  const mockData: ApiBasedExtensionResponse[] = [
    { id: '1', name: 'Extension 1', api_endpoint: 'https://api1.test', api_key: 'key1' },
    { id: '2', name: 'Extension 2', api_endpoint: 'https://api2.test', api_key: 'key2' },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    listExtensions.mockResolvedValue(mockData)
  })

  it('selects an extension, updates its displayed name and closes the picker', async () => {
    const user = userEvent.setup()
    function Selector() {
      const [value, setValue] = useState('1')
      return <ApiBasedExtensionSelector value={value} onChange={setValue} />
    }
    render(<Selector />)
    await user.click(await screen.findByRole('button', { name: /^Extension 1/ }))
    await user.click(await screen.findByRole('button', { name: /^Extension 2/ }))
    await waitFor(() =>
      expect(screen.queryByText('common.apiBasedExtension.selector.title')).not.toBeInTheDocument(),
    )
    expect(screen.getByRole('button', { name: /^Extension 2/ })).toBeVisible()
  })

  it('opens account settings at custom endpoints when choosing manage', async () => {
    const user = userEvent.setup()
    render(<ApiBasedExtensionSelector value="" onChange={mockOnChange} />)
    await user.click(
      screen.getByRole('button', { name: 'common.apiBasedExtension.selector.placeholder' }),
    )
    await user.click(
      await screen.findByRole('button', { name: 'common.apiBasedExtension.selector.manage' }),
    )
    await waitFor(() =>
      expect(onUrlUpdate.mock.lastCall?.[0].searchParams.get('settings')).toBe('custom-endpoint'),
    )
  })

  it('creates an extension from the picker and closes the dialog after saving', async () => {
    const user = userEvent.setup()
    mockCreateApiBasedExtension.mockResolvedValue({
      id: 'new-id',
      name: 'New Ext',
      api_endpoint: 'https://api.test',
      api_key: 'secret-key',
    })
    render(<ApiBasedExtensionSelector value="" onChange={mockOnChange} />)
    await user.click(
      screen.getByRole('button', { name: 'common.apiBasedExtension.selector.placeholder' }),
    )
    await user.click(await screen.findByRole('button', { name: 'common.operation.add' }))
    await user.type(
      await screen.findByPlaceholderText('common.apiBasedExtension.modal.name.placeholder'),
      'New Ext',
    )
    await user.type(
      screen.getByPlaceholderText('common.apiBasedExtension.modal.apiEndpoint.placeholder'),
      'https://api.test',
    )
    await user.type(
      screen.getByPlaceholderText('common.apiBasedExtension.modal.apiKey.placeholder'),
      'secret-key',
    )
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
    await waitFor(() => {
      expect(mockCreateApiBasedExtension).toHaveBeenCalledWith({
        body: { name: 'New Ext', api_endpoint: 'https://api.test', api_key: 'secret-key' },
      })
      expect(
        screen.queryByRole('dialog', { name: 'common.apiBasedExtension.modal.title' }),
      ).not.toBeInTheDocument()
    })
  })
})
