import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import CredentialSelector from './index'

// Mock CredentialIcon since it's likely a complex component or uses next/image
vi.mock('@/app/components/datasets/common/credential-icon', () => ({
  CredentialIcon: ({ name }: { name: string }) => <div data-testid="credential-icon">{name}</div>,
}))

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
  it('should render current workspace name', () => {
    render(<CredentialSelector value="1" items={mockItems} onSelect={vi.fn()} />)

    expect(screen.getByTestId('notion-credential-selector-name')).toHaveTextContent('Notion Workspace 1')
  })

  it('should show all workspaces when menu is clicked', async () => {
    const user = userEvent.setup()
    render(<CredentialSelector value="1" items={mockItems} onSelect={vi.fn()} />)

    const btn = screen.getByTestId('notion-credential-selector-btn')
    await user.click(btn)

    expect(screen.getByTestId('notion-credential-item-1')).toBeInTheDocument()
    expect(screen.getByTestId('notion-credential-item-2')).toBeInTheDocument()
  })

  it('should call onSelect when a workspace is clicked', async () => {
    const handleSelect = vi.fn()
    const user = userEvent.setup()
    render(<CredentialSelector value="1" items={mockItems} onSelect={handleSelect} />)

    const btn = screen.getByTestId('notion-credential-selector-btn')
    await user.click(btn)

    const item2 = screen.getByTestId('notion-credential-item-2')
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

    expect(screen.getByTestId('notion-credential-selector-name')).toHaveTextContent('Credential Name 1')
  })
})
