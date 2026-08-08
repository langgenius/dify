import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ApiServer from '../ApiServer'

vi.mock('@/app/components/develop/secret-key/secret-key-modal', () => ({
  default: ({ isShow, onClose }: { isShow: boolean; onClose: () => void }) =>
    isShow ? (
      <div role="dialog" aria-label="Secret key">
        <button type="button" onClick={onClose}>
          Close Modal
        </button>
      </div>
    ) : null,
}))

describe('ApiServer', () => {
  it('shows the configured API endpoint', () => {
    render(<ApiServer apiBaseUrl="https://api.example.com/v1" />)

    expect(screen.getByText('https://api.example.com/v1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /apiKey/i })).toBeDisabled()
  })

  it('opens and closes API key management for authorized users', async () => {
    const user = userEvent.setup()
    render(<ApiServer apiBaseUrl="https://api.example.com" appId="app-123" canManageApiKey />)

    await user.click(screen.getByRole('button', { name: /apiKey/i }))
    expect(screen.getByRole('dialog', { name: 'Secret key' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Close Modal' }))
    expect(screen.queryByRole('dialog', { name: 'Secret key' })).not.toBeInTheDocument()
  })
})
