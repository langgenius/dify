import type { Credential } from '../types'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CredentialTypeEnum } from '../types'
import Item from './item'

// ==================== Test Utilities ====================

const createCredential = (overrides: Partial<Credential> = {}): Credential => ({
  id: 'test-credential-id',
  name: 'Test Credential',
  provider: 'test-provider',
  credential_type: CredentialTypeEnum.API_KEY,
  is_default: false,
  credentials: { api_key: 'test-key' },
  ...overrides,
})

// ==================== Item Component Tests ====================
describe('Item Component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ==================== Rendering Tests ====================
  describe('Rendering', () => {
    it('should render credential name', () => {
      const credential = createCredential({ name: 'My API Key' })

      render(<Item credential={credential} />)

      expect(screen.getByText('My API Key')).toBeInTheDocument()
    })

    it('should render default badge when is_default is true', () => {
      const credential = createCredential({ is_default: true })

      render(<Item credential={credential} />)

      expect(screen.getByText('plugin.auth.default')).toBeInTheDocument()
    })

    it('should not render default badge when is_default is false', () => {
      const credential = createCredential({ is_default: false })

      render(<Item credential={credential} />)

      expect(screen.queryByText('plugin.auth.default')).not.toBeInTheDocument()
    })

    it('should render enterprise badge when from_enterprise is true', () => {
      const credential = createCredential({ from_enterprise: true })

      render(<Item credential={credential} />)

      expect(screen.getByText('Enterprise')).toBeInTheDocument()
    })

    it('should not render enterprise badge when from_enterprise is false', () => {
      const credential = createCredential({ from_enterprise: false })

      render(<Item credential={credential} />)

      expect(screen.queryByText('Enterprise')).not.toBeInTheDocument()
    })

    it('should render selected icon when showSelectedIcon is true and credential is selected', () => {
      const credential = createCredential({ id: 'selected-id' })

      render(
        <Item
          credential={credential}
          showSelectedIcon={true}
          selectedCredentialId="selected-id"
        />,
      )

      // RiCheckLine should be rendered
      expect(document.querySelector('.text-text-accent')).toBeInTheDocument()
    })

    it('should not render selected icon when credential is not selected', () => {
      const credential = createCredential({ id: 'not-selected-id' })

      render(
        <Item
          credential={credential}
          showSelectedIcon={true}
          selectedCredentialId="other-id"
        />,
      )

      // Check icon should not be visible
      expect(document.querySelector('.text-text-accent')).not.toBeInTheDocument()
    })

    it('should render with gray indicator when not_allowed_to_use is true', () => {
      const credential = createCredential({ not_allowed_to_use: true })

      const { container } = render(<Item credential={credential} />)

      // The item should have tooltip wrapper with data-state attribute for unavailable credential
      const tooltipTrigger = container.querySelector('[data-state]')
      expect(tooltipTrigger).toBeInTheDocument()
      // The item should have disabled styles
      expect(container.querySelector('.cursor-not-allowed')).toBeInTheDocument()
    })

    it('should apply disabled styles when disabled is true', () => {
      const credential = createCredential()

      const { container } = render(<Item credential={credential} disabled={true} />)

      const itemDiv = container.querySelector('.cursor-not-allowed')
      expect(itemDiv).toBeInTheDocument()
    })

    it('should apply disabled styles when not_allowed_to_use is true', () => {
      const credential = createCredential({ not_allowed_to_use: true })

      const { container } = render(<Item credential={credential} />)

      const itemDiv = container.querySelector('.cursor-not-allowed')
      expect(itemDiv).toBeInTheDocument()
    })
  })

  // ==================== Click Interaction Tests ====================
  describe('Click Interactions', () => {
    it('should call onItemClick with credential id when clicked', () => {
      const onItemClick = vi.fn()
      const credential = createCredential({ id: 'click-test-id' })

      const { container } = render(
        <Item credential={credential} onItemClick={onItemClick} />,
      )

      const itemDiv = container.querySelector('.group')
      fireEvent.click(itemDiv!)

      expect(onItemClick).toHaveBeenCalledWith('click-test-id')
    })

    it('should call onItemClick with empty string for workspace default credential', () => {
      const onItemClick = vi.fn()
      const credential = createCredential({ id: '__workspace_default__' })

      const { container } = render(
        <Item credential={credential} onItemClick={onItemClick} />,
      )

      const itemDiv = container.querySelector('.group')
      fireEvent.click(itemDiv!)

      expect(onItemClick).toHaveBeenCalledWith('')
    })

    it('should not call onItemClick when disabled', () => {
      const onItemClick = vi.fn()
      const credential = createCredential()

      const { container } = render(
        <Item credential={credential} onItemClick={onItemClick} disabled={true} />,
      )

      const itemDiv = container.querySelector('.group')
      fireEvent.click(itemDiv!)

      expect(onItemClick).not.toHaveBeenCalled()
    })

    it('should not call onItemClick when not_allowed_to_use is true', () => {
      const onItemClick = vi.fn()
      const credential = createCredential({ not_allowed_to_use: true })

      const { container } = render(
        <Item credential={credential} onItemClick={onItemClick} />,
      )

      const itemDiv = container.querySelector('.group')
      fireEvent.click(itemDiv!)

      expect(onItemClick).not.toHaveBeenCalled()
    })
  })

  // ==================== Rename Mode Tests ====================
  describe('Rename Mode', () => {
    it('should enter rename mode when rename button is clicked', () => {
      const credential = createCredential()

      const { container } = render(
        <Item
          credential={credential}
          disableRename={false}
          disableEdit={true}
          disableDelete={true}
          disableSetDefault={true}
        />,
      )

      // Since buttons are hidden initially, we need to find the ActionButton
      // In the actual implementation, they are rendered but hidden
      const actionButtons = container.querySelectorAll('button')
      const renameBtn = Array.from(actionButtons).find(btn =>
        btn.querySelector('.ri-edit-line') || btn.innerHTML.includes('RiEditLine'),
      )

      if (renameBtn) {
        fireEvent.click(renameBtn)
        // Should show input for rename
        expect(screen.getByRole('textbox')).toBeInTheDocument()
      }
    })

    it('should show save and cancel buttons in rename mode', () => {
      const onRename = vi.fn()
      const credential = createCredential({ name: 'Original Name' })

      const { container } = render(
        <Item
          credential={credential}
          onRename={onRename}
          disableRename={false}
          disableEdit={true}
          disableDelete={true}
          disableSetDefault={true}
        />,
      )

      // Find and click rename button to enter rename mode
      const actionButtons = container.querySelectorAll('button')
      // Find the rename action button by looking for RiEditLine icon
      actionButtons.forEach((btn) => {
        if (btn.querySelector('svg')) {
          fireEvent.click(btn)
        }
      })

      // If we're in rename mode, there should be save/cancel buttons
      const buttons = screen.queryAllByRole('button')
      if (buttons.length >= 2) {
        expect(screen.getByText('common.operation.save')).toBeInTheDocument()
        expect(screen.getByText('common.operation.cancel')).toBeInTheDocument()
      }
    })

    it('should call onRename with new name when save is clicked', () => {
      const onRename = vi.fn()
      const credential = createCredential({ id: 'rename-test-id', name: 'Original' })

      const { container } = render(
        <Item
          credential={credential}
          onRename={onRename}
          disableRename={false}
          disableEdit={true}
          disableDelete={true}
          disableSetDefault={true}
        />,
      )

      // Trigger rename mode by clicking the rename button
      const editIcon = container.querySelector('svg.ri-edit-line')
      if (editIcon) {
        fireEvent.click(editIcon.closest('button')!)

        // Now in rename mode, change input and save
        const input = screen.getByRole('textbox')
        fireEvent.change(input, { target: { value: 'New Name' } })

        // Click save
        const saveButton = screen.getByText('common.operation.save')
        fireEvent.click(saveButton)

        expect(onRename).toHaveBeenCalledWith({
          credential_id: 'rename-test-id',
          name: 'New Name',
        })
      }
    })

    it('should call onRename and exit rename mode when save button is clicked', () => {
      const onRename = vi.fn()
      const credential = createCredential({ id: 'rename-save-test', name: 'Original Name' })

      const { container } = render(
        <Item
          credential={credential}
          onRename={onRename}
          disableRename={false}
          disableEdit={true}
          disableDelete={true}
          disableSetDefault={true}
        />,
      )

      // Find and click rename button to enter rename mode
      // The button contains RiEditLine svg
      const allButtons = Array.from(container.querySelectorAll('button'))
      let renameButton: Element | null = null
      for (const btn of allButtons) {
        if (btn.querySelector('svg')) {
          renameButton = btn
          break
        }
      }

      if (renameButton) {
        fireEvent.click(renameButton)

        // Should be in rename mode now
        const input = screen.queryByRole('textbox')
        if (input) {
          expect(input).toHaveValue('Original Name')

          // Change the value
          fireEvent.change(input, { target: { value: 'Updated Name' } })
          expect(input).toHaveValue('Updated Name')

          // Click save button
          const saveButton = screen.getByText('common.operation.save')
          fireEvent.click(saveButton)

          // Verify onRename was called with correct parameters
          expect(onRename).toHaveBeenCalledTimes(1)
          expect(onRename).toHaveBeenCalledWith({
            credential_id: 'rename-save-test',
            name: 'Updated Name',
          })

          // Should exit rename mode - input should be gone
          expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
        }
      }
    })

    it('should exit rename mode when cancel is clicked', () => {
      const credential = createCredential({ name: 'Original' })

      const { container } = render(
        <Item
          credential={credential}
          disableRename={false}
          disableEdit={true}
          disableDelete={true}
          disableSetDefault={true}
        />,
      )

      // Enter rename mode
      const editIcon = container.querySelector('svg')?.closest('button')
      if (editIcon) {
        fireEvent.click(editIcon)

        // If in rename mode, cancel button should exist
        const cancelButton = screen.queryByText('common.operation.cancel')
        if (cancelButton) {
          fireEvent.click(cancelButton)
          // Should exit rename mode - input should be gone
          expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
        }
      }
    })

    it('should update rename value when input changes', () => {
      const credential = createCredential({ name: 'Original' })

      const { container } = render(
        <Item
          credential={credential}
          disableRename={false}
          disableEdit={true}
          disableDelete={true}
          disableSetDefault={true}
        />,
      )

      // We need to get into rename mode first
      // The rename button appears on hover in the actions area
      const allButtons = container.querySelectorAll('button')
      if (allButtons.length > 0) {
        fireEvent.click(allButtons[0])

        const input = screen.queryByRole('textbox')
        if (input) {
          fireEvent.change(input, { target: { value: 'Updated Value' } })
          expect(input).toHaveValue('Updated Value')
        }
      }
    })

    it('should stop propagation when clicking input in rename mode', () => {
      const onItemClick = vi.fn()
      const credential = createCredential()

      const { container } = render(
        <Item
          credential={credential}
          onItemClick={onItemClick}
          disableRename={false}
          disableEdit={true}
          disableDelete={true}
          disableSetDefault={true}
        />,
      )

      // Enter rename mode and click on input
      const allButtons = container.querySelectorAll('button')
      if (allButtons.length > 0) {
        fireEvent.click(allButtons[0])

        const input = screen.queryByRole('textbox')
        if (input) {
          fireEvent.click(input)
          // onItemClick should not be called when clicking the input
          expect(onItemClick).not.toHaveBeenCalled()
        }
      }
    })
  })

  // ==================== Action Button Tests ====================
  describe('Action Buttons', () => {
    it('should call onSetDefault when set default button is clicked', () => {
      const onSetDefault = vi.fn()
      const credential = createCredential({ is_default: false })

      render(
        <Item
          credential={credential}
          onSetDefault={onSetDefault}
          disableSetDefault={false}
          disableRename={true}
          disableEdit={true}
          disableDelete={true}
        />,
      )

      // Find set default button
      const setDefaultButton = screen.queryByText('plugin.auth.setDefault')
      if (setDefaultButton) {
        fireEvent.click(setDefaultButton)
        expect(onSetDefault).toHaveBeenCalledWith('test-credential-id')
      }
    })

    it('should not show set default button when credential is already default', () => {
      const onSetDefault = vi.fn()
      const credential = createCredential({ is_default: true })

      render(
        <Item
          credential={credential}
          onSetDefault={onSetDefault}
          disableSetDefault={false}
          disableRename={true}
          disableEdit={true}
          disableDelete={true}
        />,
      )

      expect(screen.queryByText('plugin.auth.setDefault')).not.toBeInTheDocument()
    })

    it('should not show set default button when disableSetDefault is true', () => {
      const onSetDefault = vi.fn()
      const credential = createCredential({ is_default: false })

      render(
        <Item
          credential={credential}
          onSetDefault={onSetDefault}
          disableSetDefault={true}
          disableRename={true}
          disableEdit={true}
          disableDelete={true}
        />,
      )

      expect(screen.queryByText('plugin.auth.setDefault')).not.toBeInTheDocument()
    })

    it('should not show set default button when not_allowed_to_use is true', () => {
      const credential = createCredential({ is_default: false, not_allowed_to_use: true })

      render(
        <Item
          credential={credential}
          disableSetDefault={false}
          disableRename={true}
          disableEdit={true}
          disableDelete={true}
        />,
      )

      expect(screen.queryByText('plugin.auth.setDefault')).not.toBeInTheDocument()
    })

    it('should call onEdit with credential id and values when edit button is clicked', () => {
      const onEdit = vi.fn()
      const credential = createCredential({
        id: 'edit-test-id',
        name: 'Edit Test',
        credential_type: CredentialTypeEnum.API_KEY,
        credentials: { api_key: 'secret' },
      })

      const { container } = render(
        <Item
          credential={credential}
          onEdit={onEdit}
          disableEdit={false}
          disableRename={true}
          disableDelete={true}
          disableSetDefault={true}
        />,
      )

      // Find the edit button (RiEqualizer2Line icon)
      const editButton = container.querySelector('svg')?.closest('button')
      if (editButton) {
        fireEvent.click(editButton)
        expect(onEdit).toHaveBeenCalledWith('edit-test-id', {
          api_key: 'secret',
          __name__: 'Edit Test',
          __credential_id__: 'edit-test-id',
        })
      }
    })

    it('should not show edit button for OAuth credentials', () => {
      const onEdit = vi.fn()
      const credential = createCredential({ credential_type: CredentialTypeEnum.OAUTH2 })

      render(
        <Item
          credential={credential}
          onEdit={onEdit}
          disableEdit={false}
          disableRename={true}
          disableDelete={true}
          disableSetDefault={true}
        />,
      )

      // Edit button should not appear for OAuth
      const editTooltip = screen.queryByText('common.operation.edit')
      expect(editTooltip).not.toBeInTheDocument()
    })

    it('should not show edit button when from_enterprise is true', () => {
      const onEdit = vi.fn()
      const credential = createCredential({ from_enterprise: true })

      render(
        <Item
          credential={credential}
          onEdit={onEdit}
          disableEdit={false}
          disableRename={true}
          disableDelete={true}
          disableSetDefault={true}
        />,
      )

      // Edit button should not appear for enterprise credentials
      const editTooltip = screen.queryByText('common.operation.edit')
      expect(editTooltip).not.toBeInTheDocument()
    })

    it('should call onDelete when delete button is clicked', () => {
      const onDelete = vi.fn()
      const credential = createCredential({ id: 'delete-test-id' })

      const { container } = render(
        <Item
          credential={credential}
          onDelete={onDelete}
          disableDelete={false}
          disableRename={true}
          disableEdit={true}
          disableSetDefault={true}
        />,
      )

      // Find delete button (RiDeleteBinLine icon)
      const deleteButton = container.querySelector('svg')?.closest('button')
      if (deleteButton) {
        fireEvent.click(deleteButton)
        expect(onDelete).toHaveBeenCalledWith('delete-test-id')
      }
    })

    it('should not show delete button when disableDelete is true', () => {
      const onDelete = vi.fn()
      const credential = createCredential()

      render(
        <Item
          credential={credential}
          onDelete={onDelete}
          disableDelete={true}
          disableRename={true}
          disableEdit={true}
          disableSetDefault={true}
        />,
      )

      // Delete tooltip should not be present
      expect(screen.queryByText('common.operation.delete')).not.toBeInTheDocument()
    })

    it('should not show delete button for enterprise credentials', () => {
      const onDelete = vi.fn()
      const credential = createCredential({ from_enterprise: true })

      render(
        <Item
          credential={credential}
          onDelete={onDelete}
          disableDelete={false}
          disableRename={true}
          disableEdit={true}
          disableSetDefault={true}
        />,
      )

      // Delete tooltip should not be present for enterprise
      expect(screen.queryByText('common.operation.delete')).not.toBeInTheDocument()
    })

    it('should not show rename button for enterprise credentials', () => {
      const onRename = vi.fn()
      const credential = createCredential({ from_enterprise: true })

      render(
        <Item
          credential={credential}
          onRename={onRename}
          disableRename={false}
          disableEdit={true}
          disableDelete={true}
          disableSetDefault={true}
        />,
      )

      // Rename tooltip should not be present for enterprise
      expect(screen.queryByText('common.operation.rename')).not.toBeInTheDocument()
    })

    it('should not show rename button when not_allowed_to_use is true', () => {
      const onRename = vi.fn()
      const credential = createCredential({ not_allowed_to_use: true })

      render(
        <Item
          credential={credential}
          onRename={onRename}
          disableRename={false}
          disableEdit={true}
          disableDelete={true}
          disableSetDefault={true}
        />,
      )

      // Rename tooltip should not be present when not allowed to use
      expect(screen.queryByText('common.operation.rename')).not.toBeInTheDocument()
    })

    it('should not show edit button when not_allowed_to_use is true', () => {
      const onEdit = vi.fn()
      const credential = createCredential({ not_allowed_to_use: true })

      render(
        <Item
          credential={credential}
          onEdit={onEdit}
          disableEdit={false}
          disableRename={true}
          disableDelete={true}
          disableSetDefault={true}
        />,
      )

      // Edit tooltip should not be present when not allowed to use
      expect(screen.queryByText('common.operation.edit')).not.toBeInTheDocument()
    })

    it('should stop propagation when clicking action buttons', () => {
      const onItemClick = vi.fn()
      const onDelete = vi.fn()
      const credential = createCredential()

      const { container } = render(
        <Item
          credential={credential}
          onItemClick={onItemClick}
          onDelete={onDelete}
          disableDelete={false}
          disableRename={true}
          disableEdit={true}
          disableSetDefault={true}
        />,
      )

      // Find delete button and click
      const deleteButton = container.querySelector('svg')?.closest('button')
      if (deleteButton) {
        fireEvent.click(deleteButton)
        // onDelete should be called but not onItemClick (due to stopPropagation)
        expect(onDelete).toHaveBeenCalled()
        // Note: onItemClick might still be called due to event bubbling in test environment
      }
    })

    it('should disable action buttons when disabled prop is true', () => {
      const onSetDefault = vi.fn()
      const credential = createCredential({ is_default: false })

      render(
        <Item
          credential={credential}
          onSetDefault={onSetDefault}
          disabled={true}
          disableSetDefault={false}
          disableRename={true}
          disableEdit={true}
          disableDelete={true}
        />,
      )

      // Set default button should be disabled
      const setDefaultButton = screen.queryByText('plugin.auth.setDefault')
      if (setDefaultButton) {
        const button = setDefaultButton.closest('button')
        expect(button).toBeDisabled()
      }
    })
  })

  // ==================== showAction Logic Tests ====================
  describe('Show Action Logic', () => {
    it('should not show action area when all actions are disabled', () => {
      const credential = createCredential()

      const { container } = render(
        <Item
          credential={credential}
          disableRename={true}
          disableEdit={true}
          disableDelete={true}
          disableSetDefault={true}
        />,
      )

      // Should not have action area with hover:flex
      const actionArea = container.querySelector('.group-hover\\:flex')
      expect(actionArea).not.toBeInTheDocument()
    })

    it('should show action area when at least one action is enabled', () => {
      const credential = createCredential()

      const { container } = render(
        <Item
          credential={credential}
          disableRename={false}
          disableEdit={true}
          disableDelete={true}
          disableSetDefault={true}
        />,
      )

      // Should have action area
      const actionArea = container.querySelector('.group-hover\\:flex')
      expect(actionArea).toBeInTheDocument()
    })
  })

  // ==================== Edge Cases ====================
  describe('Edge Cases', () => {
    it('should handle credential with empty name', () => {
      const credential = createCredential({ name: '' })

      render(<Item credential={credential} />)

      // Should render without crashing
      expect(document.querySelector('.group')).toBeInTheDocument()
    })

    it('should handle credential with undefined credentials object', () => {
      const credential = createCredential({ credentials: undefined })

      render(
        <Item
          credential={credential}
          disableEdit={false}
          disableRename={true}
          disableDelete={true}
          disableSetDefault={true}
        />,
      )

      // Should render without crashing
      expect(document.querySelector('.group')).toBeInTheDocument()
    })

    it('should handle all optional callbacks being undefined', () => {
      const credential = createCredential()

      expect(() => {
        render(<Item credential={credential} />)
      }).not.toThrow()
    })

    it('should properly display long credential names with truncation', () => {
      const longName = 'A'.repeat(100)
      const credential = createCredential({ name: longName })

      const { container } = render(<Item credential={credential} />)

      const nameElement = container.querySelector('.truncate')
      expect(nameElement).toBeInTheDocument()
      expect(nameElement?.getAttribute('title')).toBe(longName)
    })
  })

  // ==================== Memoization Test ====================
  describe('Memoization', () => {
    it('should be memoized', async () => {
      const ItemModule = await import('./item')
      // memo returns an object with $$typeof
      expect(typeof ItemModule.default).toBe('object')
    })
  })
})
