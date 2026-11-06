import type { DatasourceCredentialResponse } from '@dify/contracts/api/console/auth/types.gen'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CredentialSelector from '../index'

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
] as DatasourceCredentialResponse[]

describe('CredentialSelector', () => {
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

  it('selects another credential and reflects the controlled value after closing the popup', async () => {
    const user = userEvent.setup()
    const onCredentialChange = vi.fn()
    const { rerender } = render(
      <CredentialSelector
        currentCredentialId="credential-1"
        credentials={credentials}
        onCredentialChange={onCredentialChange}
      />,
    )
    const trigger = screen.getByRole('button', { name: /First credential/ })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    await user.click(trigger)
    await user.click(await screen.findByText('Second credential'))
    expect(onCredentialChange).toHaveBeenCalledExactlyOnceWith('credential-2')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
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
