import type { DataSourceCredential } from '@/types/pipeline'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import List from '../list'

vi.mock('@/app/components/datasets/common/credential-icon', () => ({
  CredentialIcon: () => <span data-testid="credential-icon" />,
}))

describe('CredentialSelectorList', () => {
  const mockCredentials: DataSourceCredential[] = [
    { id: 'cred-1', name: 'Account A', avatar_url: '' } as DataSourceCredential,
    { id: 'cred-2', name: 'Account B', avatar_url: '' } as DataSourceCredential,
  ]

  const defaultProps = {
    currentCredentialId: 'cred-1',
    credentials: mockCredentials,
    onCredentialChange: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render all credentials', () => {
    render(<List {...defaultProps} />)
    expect(screen.getByText('Account A')).toBeInTheDocument()
    expect(screen.getByText('Account B')).toBeInTheDocument()
  })

  it('should call onCredentialChange on item click', () => {
    render(<List {...defaultProps} />)
    fireEvent.click(screen.getByText('Account B'))
    expect(defaultProps.onCredentialChange).toHaveBeenCalledWith('cred-2')
  })
})
