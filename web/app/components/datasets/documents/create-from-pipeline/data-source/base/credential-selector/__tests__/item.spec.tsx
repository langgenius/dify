import type { DataSourceCredential } from '@/types/pipeline'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Item from '../item'

vi.mock('@/app/components/datasets/common/credential-icon', () => ({
  CredentialIcon: () => <span data-testid="credential-icon" />,
}))

describe('CredentialSelectorItem', () => {
  const defaultProps = {
    credential: { id: 'cred-1', name: 'My Account', avatar_url: 'https://example.com/avatar.png' } as DataSourceCredential,
    isSelected: false,
    onCredentialChange: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render credential name and icon', () => {
    render(<Item {...defaultProps} />)
    expect(screen.getByText('My Account')).toBeInTheDocument()
    expect(screen.getByTestId('credential-icon')).toBeInTheDocument()
  })

  it('should call onCredentialChange with credential id on click', () => {
    render(<Item {...defaultProps} />)
    fireEvent.click(screen.getByText('My Account'))
    expect(defaultProps.onCredentialChange).toHaveBeenCalledWith('cred-1')
  })
})
