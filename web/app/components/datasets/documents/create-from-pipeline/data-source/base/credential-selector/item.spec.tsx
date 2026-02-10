import type { DataSourceCredential } from '@/types/pipeline'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Item from './item'

vi.mock('@remixicon/react', () => ({
  RiCheckLine: (props: React.SVGProps<SVGSVGElement>) => <svg data-testid="check-icon" {...props} />,
}))
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

  it('should show check icon when selected', () => {
    render(<Item {...defaultProps} isSelected={true} />)
    expect(screen.getByTestId('check-icon')).toBeInTheDocument()
  })

  it('should not show check icon when not selected', () => {
    render(<Item {...defaultProps} isSelected={false} />)
    expect(screen.queryByTestId('check-icon')).not.toBeInTheDocument()
  })

  it('should call onCredentialChange with credential id on click', () => {
    render(<Item {...defaultProps} />)
    fireEvent.click(screen.getByText('My Account'))
    expect(defaultProps.onCredentialChange).toHaveBeenCalledWith('cred-1')
  })
})
