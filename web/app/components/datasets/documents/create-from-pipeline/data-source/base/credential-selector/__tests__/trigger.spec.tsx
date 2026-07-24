import type { DataSourceCredential } from '@/types/pipeline'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import Trigger from '../trigger'

vi.mock('@/app/components/datasets/common/credential-icon', () => ({
  CredentialIcon: () => <span data-testid="credential-icon" />,
}))

describe('CredentialSelectorTrigger', () => {
  it('should render credential name when provided', () => {
    render(
      <Trigger
        currentCredential={{ id: 'cred-1', name: 'Account A', avatar_url: '' } as DataSourceCredential}
        isOpen={false}
      />,
    )
    expect(screen.getByText('Account A')).toBeInTheDocument()
  })

  it('should render empty name when no credential', () => {
    render(<Trigger currentCredential={undefined} isOpen={false} />)
    expect(screen.getByTestId('credential-icon')).toBeInTheDocument()
  })

  it('should apply hover style when open', () => {
    const { container } = render(
      <Trigger
        currentCredential={{ id: 'cred-1', name: 'A', avatar_url: '' } as DataSourceCredential}
        isOpen={true}
      />,
    )
    const wrapper = container.firstChild as HTMLElement
    expect(wrapper.className).toContain('bg-state-base-hover')
  })
})
