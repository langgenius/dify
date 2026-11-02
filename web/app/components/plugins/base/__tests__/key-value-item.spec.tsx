import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vite-plus/test'
import KeyValueItem from '../key-value-item'

const mockCopy = vi.fn()
vi.mock('copy-to-clipboard', () => ({
  default: (...args: unknown[]) => mockCopy(...args),
}))

describe('KeyValueItem', () => {
  it('renders label and value', () => {
    render(<KeyValueItem label="ID" value="abc-123" />)
    expect(screen.getByText('ID')).toBeInTheDocument()
    expect(screen.getByText('abc-123')).toBeInTheDocument()
  })

  it('associates the label with the copy action and announces the result', async () => {
    const user = userEvent.setup()
    render(<KeyValueItem label="Key" value="sk-secret" maskedValue="sk-***" />)
    expect(screen.getByText('sk-***')).toBeInTheDocument()
    expect(screen.queryByText('sk-secret')).not.toBeInTheDocument()

    const keyGroup = screen.getByRole('group', { name: 'Key' })
    const copyButton = within(keyGroup).getByRole('button', {
      name: 'common.operation.copy: Key',
    })

    await user.click(copyButton)

    expect(mockCopy).toHaveBeenCalledWith('sk-secret')
    expect(copyButton).toHaveAccessibleName('common.operation.copy: Key')
    expect(within(keyGroup).getByRole('status')).toHaveTextContent('common.operation.copied: Key')
  })
})
