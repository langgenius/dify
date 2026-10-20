import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vite-plus/test'
import CredentialSelector from '../index'

const mockItems = [
  {
    credentialId: '1',
    credentialName: 'Workspace 1',
    workspaceName: 'Notion Workspace 1',
  },
  {
    credentialId: '2',
    credentialName: 'Workspace 2',
    workspaceName: 'Notion Workspace 2',
  },
]

describe('CredentialSelector', () => {
  it('should call onSelect when a workspace is clicked', async () => {
    const handleSelect = vi.fn()
    const user = userEvent.setup()
    render(<CredentialSelector value="1" items={mockItems} onSelect={handleSelect} />)

    const btn = screen.getByRole('combobox', { name: /Notion Workspace 1/ })
    await user.click(btn)

    expect(screen.getByRole('option', { name: 'Notion Workspace 1' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    const item2 = screen.getByRole('option', { name: /Notion Workspace 2/ })
    await user.click(item2)

    expect(handleSelect).toHaveBeenCalledWith('2')
  })

  it('should use credentialName if workspaceName is missing', () => {
    const itemsWithoutWorkspaceName = [
      {
        credentialId: '1',
        credentialName: 'Credential Name 1',
      },
    ]
    render(<CredentialSelector value="1" items={itemsWithoutWorkspaceName} onSelect={vi.fn()} />)

    expect(screen.getByRole('combobox', { name: 'Credential Name 1' })).toBeInTheDocument()
  })
})
