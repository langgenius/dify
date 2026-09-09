import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { render } from '@/test/console/render'
import { IpPolicyDialog } from '../policy-dialog'

const translations = vi.hoisted(() => ({
  'operation.cancel': 'Cancel',
  'operation.close': 'Close',
  'operation.save': 'Save',
  'settings.ipPolicyAddCurrentIp': 'Add it',
  'settings.ipPolicyAddEntry': 'Add',
  'settings.ipPolicyAllowlist': 'Allowlist',
  'settings.ipPolicyAllowlistHelp':
    'Single addresses (203.0.113.42) or CIDR ranges (10.0.0.0/8). IPv4 and IPv6 are both accepted.',
  'settings.ipPolicyCreate': 'Create',
  'settings.ipPolicyCurrentIp': 'Your current IP is {{ip}}',
  'settings.ipPolicyDialogDescription':
    'Specify which IP addresses or ranges can access your apps.',
  'settings.ipPolicyEntryOctetRange': 'Each octet must be 0–255',
  'settings.ipPolicyName': 'Name',
  'settings.ipPolicyNamePlaceholder': 'e.g. Internal Network',
  'settings.ipPolicyNewTitle': 'New IP Policy',
  'settings.ipPolicyRemoveEntry': 'Remove entry',
}))

vi.mock('react-i18next', async () => {
  const { createReactI18nextMock } = await import('@/test/i18n-mock')
  return createReactI18nextMock(translations)
})

function DialogHarness({
  currentIp,
  onSubmit = vi.fn(),
}: {
  currentIp?: string
  onSubmit?: (payload: { name: string; addresses: string[] }) => void
}) {
  const [open, setOpen] = useState(true)
  return (
    <IpPolicyDialog
      mode="create"
      open={open}
      currentIp={currentIp}
      onOpenChange={setOpen}
      onSubmit={onSubmit}
    />
  )
}

describe('IpPolicyDialog', () => {
  it('keeps Create disabled until the name and a valid entry are filled', async () => {
    const user = userEvent.setup()
    render(<DialogHarness />)

    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled()

    await user.type(screen.getByPlaceholderText('e.g. Internal Network'), 'Internal Network')
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled()

    await user.type(screen.getByPlaceholderText('10.0.0.0/8'), '10.0.0.0/8')
    expect(screen.getByRole('button', { name: 'Create' })).toBeEnabled()
  })

  it('shows a live error and keeps Create disabled for an invalid octet', async () => {
    const user = userEvent.setup()
    render(<DialogHarness />)

    await user.type(screen.getByPlaceholderText('e.g. Internal Network'), 'Internal Network')
    await user.type(screen.getByPlaceholderText('10.0.0.0/8'), '203.0.113.999')

    expect(screen.getByText('Each octet must be 0–255')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled()
  })

  it('keeps a single empty row when the last entry is removed', async () => {
    const user = userEvent.setup()
    render(<DialogHarness />)

    await user.click(screen.getByRole('button', { name: 'Remove entry' }))

    expect(screen.getByPlaceholderText('10.0.0.0/8')).toHaveValue('')
    expect(screen.getAllByRole('button', { name: 'Remove entry' })).toHaveLength(1)
  })

  it('adds the current IP into the first empty row', async () => {
    const user = userEvent.setup()
    render(<DialogHarness currentIp="203.0.113.42" />)

    expect(screen.getByText('Your current IP is 203.0.113.42')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Add it' }))
    expect(screen.getByPlaceholderText('10.0.0.0/8')).toHaveValue('203.0.113.42')
  })

  it('submits trimmed name and addresses', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<DialogHarness onSubmit={onSubmit} />)

    await user.type(screen.getByPlaceholderText('e.g. Internal Network'), 'Internal Network')
    await user.type(screen.getByPlaceholderText('10.0.0.0/8'), '10.0.0.0/8')
    await user.click(screen.getByRole('button', { name: 'Add' }))
    const rows = screen.getAllByPlaceholderText('10.0.0.0/8')
    expect(rows).toHaveLength(2)
    await user.type(rows[1] as HTMLElement, '203.0.113.42')
    await user.click(screen.getByRole('button', { name: 'Create' }))

    expect(onSubmit).toHaveBeenCalledWith({
      name: 'Internal Network',
      addresses: ['10.0.0.0/8', '203.0.113.42'],
    })
  })
})
