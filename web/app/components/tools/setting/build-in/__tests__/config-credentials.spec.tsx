import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { createToolProviderFixture } from '@/test/console/tool-provider-fixture'
import { selectToolProvider } from '../../../utils/query-select'
import ConfigCredential from '../config-credentials'

const api = vi.hoisted(() => ({ schema: vi.fn(), credentials: vi.fn() }))
vi.mock('@/service/tools', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/tools')>()),
  fetchBuiltInToolCredentialSchema: api.schema,
  fetchBuiltInToolCredential: api.credentials,
}))
const collection = selectToolProvider(
  createToolProviderFixture({ name: 'test', is_team_authorization: true }),
)
beforeEach(() => {
  api.schema.mockReset().mockResolvedValue([
    {
      name: 'api_key',
      type: 'string',
      label: { en_US: 'API key', zh_Hans: 'API key' },
      required: true,
      url: 'https://provider.example.com/keys',
    },
  ])
  api.credentials.mockReset().mockResolvedValue({ api_key: 'saved-key' })
})

it.each(['schema', 'credentials'] as const)(
  'reports a %s loading failure and retries the credential form',
  async (stage) => {
    const user = userEvent.setup()
    api[stage].mockRejectedValueOnce(new Error('Credential service unavailable'))
    render(<ConfigCredential collection={collection} onCancel={vi.fn()} onSaved={vi.fn()} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Credential service unavailable')
    await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))
    expect(await screen.findByRole('textbox', { name: /API key/ })).toHaveValue('saved-key')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  },
)

it.each(['save', 'remove'])(
  'preserves the form and permits retry when %s fails',
  async (action) => {
    const user = userEvent.setup()
    const save = vi
      .fn()
      .mockRejectedValueOnce(new Error('Credential rejected'))
      .mockResolvedValue(undefined)
    const remove = vi
      .fn()
      .mockRejectedValueOnce(new Error('Credential rejected'))
      .mockResolvedValue(undefined)
    render(
      <ConfigCredential
        collection={collection}
        onCancel={vi.fn()}
        onSaved={save}
        onRemove={remove}
      />,
    )
    const input = await screen.findByRole('textbox', { name: /API key/ })
    await user.clear(input)
    await user.type(input, 'replacement-key')
    expect(screen.getByRole('link', { name: 'tools.howToGet' })).toHaveAttribute(
      'href',
      'https://provider.example.com/keys',
    )
    const button = screen.getByRole('button', { name: `common.operation.${action}` })
    await user.click(button)
    expect(await screen.findByRole('alert')).toHaveTextContent('Credential rejected')
    expect(input).toHaveValue('replacement-key')
    await user.click(button)
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    if (action === 'save') expect(save).toHaveBeenLastCalledWith({ api_key: 'replacement-key' })
    else expect(remove).toHaveBeenCalledTimes(2)
  },
)
