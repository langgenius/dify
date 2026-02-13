import type { DataSourceCredential } from './types'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CredentialTypeEnum } from '@/app/components/plugins/plugin-auth/types'
import Operator from './operator'

/**
 * Type-safe mock for the Dropdown component.
 */
type DropdownMockProps = {
  items: { value: string, text: React.ReactNode }[]
  secondItems?: { value: string, text: React.ReactNode }[]
  onSelect: (item: { value: string, text: React.ReactNode }) => void
}

vi.mock('@/app/components/base/dropdown', () => ({
  default: vi.fn(({ items, secondItems, onSelect }: DropdownMockProps) => (
    <div data-testid="mock-dropdown">
      <div data-testid="items">
        {items.map(item => (
          <button key={item.value} onClick={() => onSelect(item)}>
            {item.value}
          </button>
        ))}
      </div>
      <div data-testid="second-items">
        {secondItems?.map(item => (
          <button key={item.value} onClick={() => onSelect(item)}>
            {item.value}
          </button>
        ))}
      </div>
    </div>
  )),
}))

describe('Operator Component', () => {
  const mockOnAction = vi.fn()
  const mockOnRename = vi.fn()

  const createMockCredential = (type: CredentialTypeEnum): DataSourceCredential => ({
    id: 'test-id',
    name: 'Test Credential',
    credential: {},
    type,
    is_default: false,
    avatar_url: '',
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render correct actions for API_KEY type', () => {
    const credential = createMockCredential(CredentialTypeEnum.API_KEY)
    render(<Operator credentialItem={credential} onAction={mockOnAction} onRename={mockOnRename} />)

    expect(screen.getByText('setDefault')).toBeInTheDocument()
    expect(screen.getByText('edit')).toBeInTheDocument()
    expect(screen.getByText('delete')).toBeInTheDocument()

    expect(screen.queryByText('rename')).not.toBeInTheDocument()
    expect(screen.queryByText('change')).not.toBeInTheDocument()
  })

  it('should render correct actions for OAUTH2 type', () => {
    const credential = createMockCredential(CredentialTypeEnum.OAUTH2)
    render(<Operator credentialItem={credential} onAction={mockOnAction} onRename={mockOnRename} />)

    expect(screen.getByText('setDefault')).toBeInTheDocument()
    expect(screen.getByText('rename')).toBeInTheDocument()
    expect(screen.getByText('change')).toBeInTheDocument()
    expect(screen.getByText('delete')).toBeInTheDocument()

    expect(screen.queryByText('edit')).not.toBeInTheDocument()
  })

  it('should call onRename when "rename" action is selected', () => {
    const credential = createMockCredential(CredentialTypeEnum.OAUTH2)
    render(<Operator credentialItem={credential} onAction={mockOnAction} onRename={mockOnRename} />)

    fireEvent.click(screen.getByText('rename'))
    expect(mockOnRename).toHaveBeenCalledTimes(1)
    expect(mockOnAction).not.toHaveBeenCalled()
  })

  it('should handle missing onRename gracefully when "rename" action is selected', () => {
    const credential = createMockCredential(CredentialTypeEnum.OAUTH2)
    render(<Operator credentialItem={credential} onAction={mockOnAction} />)

    expect(() => fireEvent.click(screen.getByText('rename'))).not.toThrow()
  })

  it('should call onAction for "setDefault" action', () => {
    const credential = createMockCredential(CredentialTypeEnum.API_KEY)
    render(<Operator credentialItem={credential} onAction={mockOnAction} onRename={mockOnRename} />)

    fireEvent.click(screen.getByText('setDefault'))
    expect(mockOnAction).toHaveBeenCalledWith('setDefault', credential)
  })

  it('should call onAction for "edit" action', () => {
    const credential = createMockCredential(CredentialTypeEnum.API_KEY)
    render(<Operator credentialItem={credential} onAction={mockOnAction} onRename={mockOnRename} />)

    fireEvent.click(screen.getByText('edit'))
    expect(mockOnAction).toHaveBeenCalledWith('edit', credential)
  })

  it('should call onAction for "change" action', () => {
    const credential = createMockCredential(CredentialTypeEnum.OAUTH2)
    render(<Operator credentialItem={credential} onAction={mockOnAction} onRename={mockOnRename} />)

    fireEvent.click(screen.getByText('change'))
    expect(mockOnAction).toHaveBeenCalledWith('change', credential)
  })

  it('should call onAction for "delete" action', () => {
    const credential = createMockCredential(CredentialTypeEnum.API_KEY)
    render(<Operator credentialItem={credential} onAction={mockOnAction} onRename={mockOnRename} />)

    fireEvent.click(screen.getByText('delete'))
    expect(mockOnAction).toHaveBeenCalledWith('delete', credential)
  })
})
