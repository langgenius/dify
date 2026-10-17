import type { Collection } from '../../../types'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from '@/app/notifications'
import { fetchBuiltInToolCredential, fetchBuiltInToolCredentialSchema } from '@/service/tools'
import ConfigCredential from '../config-credentials'

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useLanguage: () => 'en_US',
}))
vi.mock('@/service/tools', () => ({
  fetchBuiltInToolCredentialSchema: vi.fn(),
  fetchBuiltInToolCredential: vi.fn(),
}))
const collection: Collection = {
  id: 'test-collection',
  name: 'test-tool',
  author: 'Test',
  icon: '',
  type: 'builtin',
  description: { en_US: 'Test', zh_Hans: '测试' },
  label: { en_US: 'Test', zh_Hans: '测试' },
  team_credentials: {},
  is_team_authorization: true,
  allow_delete: false,
  labels: [],
}
beforeEach(() => {
  vi.mocked(fetchBuiltInToolCredentialSchema).mockResolvedValue([
    {
      name: 'api_key',
      label: { en_US: 'API Key', zh_Hans: 'API Key' },
      type: 'secret-input',
      required: true,
      help: null,
      placeholder: { en_US: '', zh_Hans: '' },
      default: '',
    },
  ])
  vi.mocked(fetchBuiltInToolCredential).mockResolvedValue({ api_key: 'sk-existing' })
})

it('loads saved credentials, validates required values, and saves the edited key once', async () => {
  const user = userEvent.setup()
  let finishSave!: () => void
  const onSaved = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finishSave = resolve
      }),
  )
  const error = vi.spyOn(toast, 'error').mockReturnValue('required-field')
  render(<ConfigCredential collection={collection} onCancel={vi.fn()} onSaved={onSaved} />)
  expect(screen.getByRole('progressbar')).toBeInTheDocument()
  const key = await screen.findByLabelText(/API Key/)
  expect(key).toHaveValue('sk-existing')
  expect(fetchBuiltInToolCredentialSchema).toHaveBeenCalledWith('test-tool')
  expect(fetchBuiltInToolCredential).toHaveBeenCalledWith('test-tool')
  await user.clear(key)
  const save = screen.getByRole('button', { name: 'common.operation.save' })
  await user.click(save)
  expect(error).toHaveBeenCalled()
  expect(onSaved).not.toHaveBeenCalled()
  await user.type(key, 'sk-replacement')
  await user.click(save)
  expect(save).toHaveAttribute('aria-disabled', 'true')
  await user.click(save)
  expect(onSaved).toHaveBeenCalledExactlyOnceWith({ api_key: 'sk-replacement' })
  await act(async () => finishSave())
  await waitFor(() => expect(save).not.toHaveAttribute('aria-disabled', 'true'))
  error.mockRestore()
})

it.each(['cancel', 'remove'])('dispatches %s without saving credentials', async (action) => {
  const user = userEvent.setup()
  const onCancel = vi.fn()
  const onRemove = vi.fn()
  const onSaved = vi.fn()
  render(
    <ConfigCredential
      collection={collection}
      onCancel={onCancel}
      onRemove={onRemove}
      onSaved={onSaved}
    />,
  )
  await screen.findByLabelText(/API Key/)
  await user.click(screen.getByRole('button', { name: `common.operation.${action}` }))
  expect(action === 'cancel' ? onCancel : onRemove).toHaveBeenCalledOnce()
  expect(onSaved).not.toHaveBeenCalled()
})

it.each([
  { authorized: false, hidden: false, readonly: false },
  { authorized: true, hidden: true, readonly: false },
  { authorized: true, hidden: false, readonly: true },
])(
  'restricts credential actions for $authorized/$hidden/$readonly',
  async ({ authorized, hidden, readonly }) => {
    render(
      <ConfigCredential
        collection={{ ...collection, is_team_authorization: authorized }}
        onCancel={vi.fn()}
        onSaved={vi.fn()}
        isHideRemoveBtn={hidden}
        readonly={readonly}
      />,
    )
    const key = await screen.findByLabelText(/API Key/)
    expect(
      screen.queryByRole('button', { name: 'common.operation.remove' }),
    ).not.toBeInTheDocument()
    if (readonly) {
      expect(key).toBeDisabled()
      expect(
        screen.queryByRole('button', { name: 'common.operation.save' }),
      ).not.toBeInTheDocument()
    }
  },
)
