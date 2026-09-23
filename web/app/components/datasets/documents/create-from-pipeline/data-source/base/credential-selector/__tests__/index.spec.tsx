import type { DataSourceCredential } from '@/types/pipeline'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import CredentialSelector from '../index'

vi.mock('@/app/components/plugins/plugin-auth', () => ({
  CredentialTypeEnum: { OAUTH2: 'oauth2', API_KEY: 'api_key' },
}))

const credentials = [
  {
    id: 'credential-1',
    name: 'First credential',
    avatar_url: 'https://example.com/first.png',
    type: 'oauth2',
    is_default: false,
  },
  {
    id: 'credential-2',
    name: 'Second credential',
    avatar_url: 'https://example.com/second.png',
    type: 'oauth2',
    is_default: false,
  },
] as DataSourceCredential[]

describe('CredentialSelector', () => {
  it('renders the current credential as an accessible trigger', () => {
    render(
      <CredentialSelector
        currentCredentialId="credential-1"
        credentials={credentials}
        onCredentialChange={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: /First credential/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('selects the first credential when the current id is invalid', async () => {
    const onCredentialChange = vi.fn()
    render(
      <CredentialSelector
        currentCredentialId="missing"
        credentials={credentials}
        onCredentialChange={onCredentialChange}
      />,
    )

    await waitFor(() => expect(onCredentialChange).toHaveBeenCalledWith('credential-1'))
  })

  it('selects the visible default credential before falling back to the first one', async () => {
    const onCredentialChange = vi.fn()
    const credentialsWithDefault = credentials.map((credential, index) => ({
      ...credential,
      is_default: index === 1,
    }))
    render(
      <CredentialSelector
        currentCredentialId="missing"
        credentials={credentialsWithDefault}
        onCredentialChange={onCredentialChange}
      />,
    )

    await waitFor(() => expect(onCredentialChange).toHaveBeenCalledWith('credential-2'))
  })

  it('does not select a fallback for an empty credential list', () => {
    const onCredentialChange = vi.fn()
    render(
      <CredentialSelector
        currentCredentialId="missing"
        credentials={[]}
        onCredentialChange={onCredentialChange}
      />,
    )

    expect(onCredentialChange).not.toHaveBeenCalled()
  })

  it('opens the real popover and selects a credential', async () => {
    const onCredentialChange = vi.fn()
    render(
      <CredentialSelector
        currentCredentialId="credential-1"
        credentials={credentials}
        onCredentialChange={onCredentialChange}
      />,
    )
    const trigger = screen.getByRole('button', { name: /First credential/ })

    fireEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(await screen.findByText('Second credential'))

    expect(onCredentialChange).toHaveBeenCalledWith('credential-2')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  it('reflects an updated controlled credential', () => {
    const onCredentialChange = vi.fn()
    const { rerender } = render(
      <CredentialSelector
        currentCredentialId="credential-1"
        credentials={credentials}
        onCredentialChange={onCredentialChange}
      />,
    )

    rerender(
      <CredentialSelector
        currentCredentialId="credential-2"
        credentials={credentials}
        onCredentialChange={onCredentialChange}
      />,
    )

    expect(screen.getByRole('button', { name: /Second credential/ })).toBeInTheDocument()
  })
})
