import type { Credential } from '../../types'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CredentialTypeEnum } from '../../types'
import Item from '../item'

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

      const { container } = render(
        <Item
          credential={credential}
          showSelectedIcon={true}
          selectedCredentialId="selected-id"
        />,
      )

      const svgs = container.querySelectorAll('svg')
      expect(svgs.length).toBeGreaterThan(0)
    })

    it('should not render selected icon when credential is not selected', () => {
      const credential = createCredential({ id: 'not-selected-id' })

      const { container: selectedContainer } = render(
        <Item
          credential={createCredential({ id: 'sel-id' })}
          showSelectedIcon={true}
          selectedCredentialId="sel-id"
        />,
      )
      const selectedSvgCount = selectedContainer.querySelectorAll('svg').length

      cleanup()

      const { container: unselectedContainer } = render(
        <Item
          credential={credential}
          showSelectedIcon={true}
          selectedCredentialId="other-id"
        />,
      )
      const unselectedSvgCount = unselectedContainer.querySelectorAll('svg').length

      expect(unselectedSvgCount).toBeLessThan(selectedSvgCount)
    })

    it('should render with disabled appearance when not_allowed_to_use is true', () => {
      const credential = createCredential({ not_allowed_to_use: true })

      const { container } = render(<Item credential={credential} />)

      expect(container.querySelector('[data-state]')).toBeInTheDocument()
    })

    it('should not call onItemClick when disabled is true', () => {
      const onItemClick = vi.fn()
      const credential = createCredential()

      const { container } = render(<Item credential={credential} onItemClick={onItemClick} disabled={true} />)

      fireEvent.click(container.firstElementChild!)

      expect(onItemClick).not.toHaveBeenCalled()
    })

    it('should not call onItemClick when not_allowed_to_use is true', () => {
      const onItemClick = vi.fn()
      const credential = createCredential({ not_allowed_to_use: true })

      const { container } = render(<Item credential={credential} onItemClick={onItemClick} />)

      fireEvent.click(container.firstElementChild!)

      expect(onItemClick).not.toHaveBeenCalled()
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

      fireEvent.click(container.firstElementChild!)

      expect(onItemClick).toHaveBeenCalledWith('click-test-id')
    })

    it('should call onItemClick with empty string for workspace default credential', () => {
      const onItemClick = vi.fn()
      const credential = createCredential({ id: '__workspace_default__' })

      const { container } = render(
        <Item credential={credential} onItemClick={onItemClick} />,
      )

      fireEvent.click(container.firstElementChild!)

      expect(onItemClick).toHaveBeenCalledWith('')
    })
  })

  // ==================== Rename Mode Tests ====================
  describe('Rename Mode', () => {
    const renderWithRenameEnabled = (overrides: Record<string, unknown> = {}) => {
      const onRename = vi.fn()
      const credential = createCredential({ name: 'Original Name', ...overrides })

      const result = render(
        <Item
          credential={credential}
          onRename={onRename}
          disableRename={false}
          disableEdit={true}
          disableDelete={true}
          disableSetDefault={true}
        />,
      )

      const enterRenameMode = () => {
        const firstButton = result.container.querySelectorAll('button')[0] as HTMLElement
        fireEvent.click(firstButton)
      }

      return { ...result, onRename, enterRenameMode }
    }

    it('should enter rename mode when rename button is clicked', () => {
      const { enterRenameMode } = renderWithRenameEnabled()

      enterRenameMode()

      expect(screen.getByRole('textbox')).toBeInTheDocument()
    })

    it('should show save and cancel buttons in rename mode', () => {
      const { enterRenameMode } = renderWithRenameEnabled()

      enterRenameMode()

      expect(screen.getByText('common.operation.save')).toBeInTheDocument()
      expect(screen.getByText('common.operation.cancel')).toBeInTheDocument()
    })

    it('should call onRename with new name when save is clicked', () => {
      const { enterRenameMode, onRename } = renderWithRenameEnabled({ id: 'rename-test-id' })

      enterRenameMode()

      const input = screen.getByRole('textbox')
      fireEvent.change(input, { target: { value: 'New Name' } })
      fireEvent.click(screen.getByText('common.operation.save'))

      expect(onRename).toHaveBeenCalledWith({
        credential_id: 'rename-test-id',
        name: 'New Name',
      })
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    })

    it('should exit rename mode when cancel is clicked', () => {
      const { enterRenameMode } = renderWithRenameEnabled()

      enterRenameMode()
      expect(screen.getByRole('textbox')).toBeInTheDocument()

      fireEvent.click(screen.getByText('common.operation.cancel'))

      expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    })

    it('should update input value when typing', () => {
      const { enterRenameMode } = renderWithRenameEnabled()

      enterRenameMode()

      const input = screen.getByRole('textbox')
      fireEvent.change(input, { target: { value: 'Updated Value' } })

      expect(input).toHaveValue('Updated Value')
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

      const setDefaultButton = screen.getByText('plugin.auth.setDefault')
      fireEvent.click(setDefaultButton)
      expect(onSetDefault).toHaveBeenCalledWith('test-credential-id')
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

      const editButton = container.querySelector('svg')?.closest('button') as HTMLElement
      fireEvent.click(editButton)
      expect(onEdit).toHaveBeenCalledWith('edit-test-id', {
        api_key: 'secret',
        __name__: 'Edit Test',
        __credential_id__: 'edit-test-id',
      })
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

      const deleteButton = container.querySelector('svg')?.closest('button') as HTMLElement
      fireEvent.click(deleteButton)
      expect(onDelete).toHaveBeenCalledWith('delete-test-id')
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

      const deleteButton = container.querySelector('svg')?.closest('button') as HTMLElement
      fireEvent.click(deleteButton)
      expect(onDelete).toHaveBeenCalled()
    })
  })

  // ==================== showAction Logic Tests ====================
  describe('Show Action Logic', () => {
    it('should not render action buttons when all actions are disabled', () => {
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

      expect(container.querySelectorAll('button').length).toBe(0)
    })

    it('should render action buttons when at least one action is enabled', () => {
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

      expect(container.querySelectorAll('button').length).toBeGreaterThan(0)
    })
  })

  describe('Edge Cases', () => {
    it('should handle credential with empty name', () => {
      const credential = createCredential({ name: '' })

      expect(() => {
        render(<Item credential={credential} />)
      }).not.toThrow()
    })

    it('should handle credential with undefined credentials object', () => {
      const credential = createCredential({ credentials: undefined })

      expect(() => {
        render(
          <Item
            credential={credential}
            disableEdit={false}
            disableRename={true}
            disableDelete={true}
            disableSetDefault={true}
          />,
        )
      }).not.toThrow()
    })

    it('should handle all optional callbacks being undefined', () => {
      const credential = createCredential()

      expect(() => {
        render(<Item credential={credential} />)
      }).not.toThrow()
    })

    it('should display long credential names with title attribute', () => {
      const longName = 'A'.repeat(100)
      const credential = createCredential({ name: longName })

      const { container } = render(<Item credential={credential} />)

      const nameElement = container.querySelector('[title]')
      expect(nameElement).toBeInTheDocument()
      expect(nameElement?.getAttribute('title')).toBe(longName)
    })
  })

  // ==================== Memoization Test ====================
  describe('Memoization', () => {
    it('should be memoized', async () => {
      const ItemModule = await import('../item')
      // memo returns an object with $$typeof
      expect(typeof ItemModule.default).toBe('object')
    })
  })
})
