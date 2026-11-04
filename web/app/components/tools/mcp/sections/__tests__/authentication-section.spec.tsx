import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { API_PREFIX } from '@/config'
import AuthenticationSection from '../authentication-section'

it('enables manual OAuth credentials with callback guidance and preserves them when switching modes', async () => {
  const user = userEvent.setup()
  const Harness = () => {
    const [dynamic, setDynamic] = useState(true)
    const [clientID, setClientID] = useState('')
    const [credentials, setCredentials] = useState('')
    return (
      <AuthenticationSection
        isDynamicRegistration={dynamic}
        onDynamicRegistrationChange={setDynamic}
        clientID={clientID}
        onClientIDChange={setClientID}
        credentials={credentials}
        onCredentialsChange={setCredentials}
      />
    )
  }
  render(<Harness />)
  const mode = screen.getByRole('switch', { name: 'tools.mcp.modal.useDynamicClientRegistration' })
  const id = screen.getByRole('textbox', { name: 'tools.mcp.modal.clientID' })
  const secret = screen.getByRole('textbox', { name: 'tools.mcp.modal.clientSecret' })
  expect(mode).toBeChecked()
  expect(id).toBeDisabled()
  expect(secret).toBeDisabled()
  expect(screen.queryByText('tools.mcp.modal.redirectUrlWarning')).not.toBeInTheDocument()
  await user.click(mode)
  expect(id).toBeEnabled()
  expect(secret).toBeEnabled()
  expect(screen.getByText(`${API_PREFIX}/mcp/oauth/callback`)).toBeInTheDocument()
  await user.type(id, 'client-id')
  await user.type(secret, 'client-secret')
  await user.click(mode)
  expect(id).toBeDisabled()
  expect(secret).toBeDisabled()
  expect(screen.queryByText('tools.mcp.modal.redirectUrlWarning')).not.toBeInTheDocument()
  await user.click(mode)
  expect(id).toHaveValue('client-id')
  expect(secret).toHaveValue('client-secret')
})
