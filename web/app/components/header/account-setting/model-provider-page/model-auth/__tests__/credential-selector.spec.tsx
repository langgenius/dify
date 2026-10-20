import type { Credential } from '../../declarations'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import CredentialSelector from '../credential-selector'

describe('CredentialSelector', () => {
  const mockCredentials = [
    { credential_id: 'cred-1', credential_name: 'Key 1' },
    { credential_id: 'cred-2', credential_name: 'Key 2' },
  ]
  const mockOnSelect = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('selects a real credential item, closes the popup, and marks it selected when reopened', async () => {
    const user = userEvent.setup()
    function Picker() {
      const [selected, setSelected] = useState<Credential>()
      return (
        <CredentialSelector
          selectedCredential={selected}
          credentials={mockCredentials}
          onSelect={(next) => {
            setSelected(next)
            mockOnSelect(next)
          }}
        />
      )
    }
    render(<Picker />)

    await user.click(screen.getByText(/modelProvider.auth.selectModelCredential/))
    expect(
      screen.getByRole('dialog', { name: /modelProvider.auth.selectModelCredential/ }),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Key 2' }))

    expect(mockOnSelect).toHaveBeenCalledExactlyOnceWith(mockCredentials[1])
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Key 2' }))
    expect(screen.getByRole('button', { name: 'Key 2', pressed: true })).toBeInTheDocument()
  })

  it('should call onSelect with add-new payload when add action is clicked', async () => {
    const user = userEvent.setup()
    render(<CredentialSelector credentials={mockCredentials} onSelect={mockOnSelect} />)

    await user.click(screen.getByText(/modelProvider.auth.selectModelCredential/))
    await user.click(screen.getByText(/modelProvider.auth.addNewModelCredential/))

    expect(mockOnSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        credential_id: '__add_new_credential',
        addNewCredential: true,
      }),
    )
  })

  it('should not open options when disabled is true', async () => {
    const user = userEvent.setup()
    render(<CredentialSelector disabled credentials={mockCredentials} onSelect={mockOnSelect} />)

    await user.click(screen.getByText(/modelProvider.auth.selectModelCredential/))
    expect(screen.queryByRole('button', { name: 'Key 1' })).not.toBeInTheDocument()
  })
})
