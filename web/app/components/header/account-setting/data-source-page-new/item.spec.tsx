import type { DataSourceCredential } from './types'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CredentialTypeEnum } from '@/app/components/plugins/plugin-auth/types'
import Item from './item'

/**
 * Mocking the Operator component to isolate the Item component tests.
 * This allows us to trigger the rename mode programmatically via the onRename prop.
 */
vi.mock('./operator', () => ({
  default: vi.fn(({ onRename }: { onRename: () => void }) => (
    <button data-testid="operator-rename" onClick={onRename}>
      Trigger Rename
    </button>
  )),
}))

describe('Item Component', () => {
  const mockOnAction = vi.fn()
  const mockCredentialItem: DataSourceCredential = {
    id: 'test-id',
    name: 'Test Credential',
    credential: {},
    type: CredentialTypeEnum.API_KEY,
    is_default: false,
    avatar_url: '',
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render the credential name and "connected" status in view mode', () => {
    render(<Item credentialItem={mockCredentialItem} onAction={mockOnAction} />)

    expect(screen.getByText('Test Credential')).toBeInTheDocument()
    expect(screen.getByText('connected')).toBeInTheDocument()
    expect(screen.getByTestId('operator-rename')).toBeInTheDocument()
  })

  it('should switch to rename mode when onRename is triggered', () => {
    render(<Item credentialItem={mockCredentialItem} onAction={mockOnAction} />)

    const renameButton = screen.getByTestId('operator-rename')
    fireEvent.click(renameButton)

    // Check for rename mode elements using the i18n mock format (ns.key)
    expect(screen.queryByText('Test Credential')).not.toBeInTheDocument()
    expect(screen.getByPlaceholderText('common.placeholder.input')).toBeInTheDocument()
    expect(screen.getByText('common.operation.save')).toBeInTheDocument()
    expect(screen.getByText('common.operation.cancel')).toBeInTheDocument()
  })

  it('should update rename value when input changes', () => {
    render(<Item credentialItem={mockCredentialItem} onAction={mockOnAction} />)

    // Enter rename mode
    fireEvent.click(screen.getByTestId('operator-rename'))

    const input = screen.getByPlaceholderText('common.placeholder.input')
    fireEvent.change(input, { target: { value: 'Updated Name' } })

    expect(input).toHaveValue('Updated Name')
  })

  it('should call onAction with "rename" and correct payload when Save is clicked', () => {
    render(<Item credentialItem={mockCredentialItem} onAction={mockOnAction} />)

    // Enter rename mode
    fireEvent.click(screen.getByTestId('operator-rename'))

    const input = screen.getByPlaceholderText('common.placeholder.input')
    fireEvent.change(input, { target: { value: 'New Name' } })

    const saveButton = screen.getByText('common.operation.save')
    fireEvent.click(saveButton)

    expect(mockOnAction).toHaveBeenCalledWith(
      'rename',
      mockCredentialItem,
      {
        credential_id: 'test-id',
        name: 'New Name',
      },
    )

    // Should switch back to view mode
    expect(screen.queryByPlaceholderText('common.placeholder.input')).not.toBeInTheDocument()
    expect(screen.getByText('Test Credential')).toBeInTheDocument()
  })

  it('should exit rename mode without calling onAction when Cancel is clicked', () => {
    render(<Item credentialItem={mockCredentialItem} onAction={mockOnAction} />)

    // Enter rename mode
    fireEvent.click(screen.getByTestId('operator-rename'))

    const input = screen.getByPlaceholderText('common.placeholder.input')
    fireEvent.change(input, { target: { value: 'Cancelled Name' } })

    const cancelButton = screen.getByText('common.operation.cancel')
    fireEvent.click(cancelButton)

    expect(mockOnAction).not.toHaveBeenCalled()

    // Should switch back to view mode
    expect(screen.queryByPlaceholderText('common.placeholder.input')).not.toBeInTheDocument()
    expect(screen.getByText('Test Credential')).toBeInTheDocument()
  })

  it('should stop event propagation when clicking Input, Save button, or Cancel button', () => {
    const parentClick = vi.fn()
    render(
      <div onClick={parentClick}>
        <Item credentialItem={mockCredentialItem} onAction={mockOnAction} />
      </div>,
    )

    // Enter rename mode
    fireEvent.click(screen.getByTestId('operator-rename'))
    // The above click would bubble up to parentClick if propagation wasn't stopped there.
    // However, the Operator mock we created doesn't stop propagation.
    // Let's clear parentClick's history to focus on the renaming interface.
    parentClick.mockClear()

    // Test Input click
    const input = screen.getByPlaceholderText('common.placeholder.input')
    fireEvent.click(input)
    expect(parentClick).not.toHaveBeenCalled()

    // Test Save click
    const saveButton = screen.getByText('common.operation.save')
    fireEvent.click(saveButton)
    expect(parentClick).not.toHaveBeenCalled()

    // Re-enter rename mode for Cancel test
    fireEvent.click(screen.getByTestId('operator-rename'))
    parentClick.mockClear()

    // Test Cancel click
    const cancelButton = screen.getByText('common.operation.cancel')
    fireEvent.click(cancelButton)
    expect(parentClick).not.toHaveBeenCalled()
  })

  it('should handle onAction being undefined gracefully even though it is required by props', () => {
    // @ts-expect-error - Testing runtime behavior when onAction is not provided despite being required
    render(<Item credentialItem={mockCredentialItem} onAction={undefined} />)

    // Enter rename mode
    fireEvent.click(screen.getByTestId('operator-rename'))

    // Click Save - it should not throw even if onAction is missing
    const saveButton = screen.getByText('common.operation.save')
    expect(() => fireEvent.click(saveButton)).not.toThrow()
  })
})
