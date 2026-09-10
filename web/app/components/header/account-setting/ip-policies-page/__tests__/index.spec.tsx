import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '@/test/console/render'
import IpPoliciesPage from '..'

const translations = vi.hoisted(() => ({
  'operation.cancel': 'Cancel',
  'operation.close': 'Close',
  'settings.ipPolicies': 'IP Policies',
  'settings.ipPoliciesDescription':
    'Reusable rules that control which IP addresses or ranges can access your apps',
  'settings.ipPolicyAddEntry': 'Add',
  'settings.ipPolicyAllowlist': 'Allowlist',
  'settings.ipPolicyAllowlistHelp':
    'Single addresses (203.0.113.42) or CIDR ranges (10.0.0.0/8). IPv4 and IPv6 are both accepted.',
  'settings.ipPolicyCreate': 'Create',
  'settings.ipPolicyDialogDescription':
    'Specify which IP addresses or ranges can access your apps.',
  'settings.ipPolicyName': 'Name',
  'settings.ipPolicyNamePlaceholder': 'e.g. Internal Network',
  'settings.ipPolicyNewTitle': 'New IP Policy',
  'settings.ipPolicyRemoveEntry': 'Remove entry',
  'studio.accessControl.emptyPoliciesDescription':
    'A policy is the list of IP addresses allowed in. Create one, then come back to apply it here.',
  'studio.accessControl.emptyPoliciesTitle': 'No IP policies in this workspace yet',
}))

vi.mock('react-i18next', async () => {
  const { createReactI18nextMock } = await import('@/test/i18n-mock')
  return createReactI18nextMock(translations)
})

describe('IpPoliciesPage', () => {
  it('opens the new policy dialog from Add', async () => {
    const user = userEvent.setup()
    render(<IpPoliciesPage />)

    expect(screen.getByText('No IP policies in this workspace yet')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Add' }))
    expect(screen.getByRole('heading', { name: 'New IP Policy' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled()
  })
})
