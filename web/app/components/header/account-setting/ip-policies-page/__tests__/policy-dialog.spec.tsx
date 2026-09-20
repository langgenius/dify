import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
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
  const { default: commonTranslations } = await import('@/i18n/en-US/common.json')
  return createReactI18nextMock({ ...commonTranslations, ...translations })
})

function DialogHarness({
  currentIp,
  onSubmit = vi.fn(),
}: {
  currentIp?: string
  onSubmit?: (payload: { name: string; allowed_cidrs: string[] }) => void
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
  beforeEach(() => {
    vi.mocked(globalThis.fetch).mockImplementation(async () =>
      Response.json({ client_ip: '203.0.113.42' }),
    )
  })
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
      allowed_cidrs: ['10.0.0.0/8', '203.0.113.42/32'],
    })
  })
})

describe('trusted current IP and allowlist editing', () => {
  beforeEach(() => {
    vi.mocked(globalThis.fetch).mockImplementation(async () =>
      Response.json({ client_ip: '203.0.113.42' }),
    )
  })

  it('loads the current IP without an existing policy and preserves input when adding it', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<DialogHarness onSubmit={onSubmit} />)
    await user.type(screen.getByPlaceholderText('10.0.0.0/8'), '10.0.0.0/8')
    expect(await screen.findByText('Your current IP is 203.0.113.42')).toBeInTheDocument()
    const request = new Request(vi.mocked(globalThis.fetch).mock.calls[0]![0])
    expect(request.method).toBe('GET')
    expect(request.url).toBe(
      'http://localhost:5001/console/api/workspaces/current/network-access-groups/current-ip',
    )
    await user.click(screen.getByRole('button', { name: 'Add it' }))
    expect(
      screen.getAllByPlaceholderText('10.0.0.0/8').map((row) => (row as HTMLInputElement).value),
    ).toEqual(['10.0.0.0/8', '203.0.113.42'])
    expect(screen.getByRole('button', { name: 'Add it' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('shows a retryable error instead of a guessed IP when the trusted endpoint returns 503', async () => {
    const user = userEvent.setup()
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      Response.json({ message: 'IP unavailable' }, { status: 503 }),
    )
    render(<DialogHarness />)
    expect(
      await screen.findByText('Unable to check your IP address. Please try again.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add it' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Your current IP is 203.0.113.42')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add it' })).toBeEnabled()
  })

  it.each(['203.0.113.42/32', '::ffff:203.0.113.42/128'])(
    'does not duplicate the current IP already stored as %s',
    async (entry) => {
      render(
        <IpPolicyDialog
          open
          mode="edit"
          initialName="Office"
          initialEntries={[entry]}
          onOpenChange={vi.fn()}
        />,
      )
      expect(await screen.findByRole('button', { name: 'Add it' })).toBeDisabled()
    },
  )

  it('does not append an IP beyond the 100 entry limit', async () => {
    render(
      <IpPolicyDialog
        open
        mode="edit"
        initialName="Office"
        initialEntries={Array.from({ length: 100 }, (_, i) => `10.0.0.${i}/32`)}
        onOpenChange={vi.fn()}
      />,
    )
    expect(await screen.findByRole('button', { name: 'Add it' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled()
    expect(screen.getAllByPlaceholderText('10.0.0.0/8')).toHaveLength(100)
  })

  it.each(['create', 'edit'] as const)(
    'accepts a mapped IPv6 address in %s mode and submits it to the server',
    async (mode) => {
      const user = userEvent.setup()
      const onSubmit = vi.fn()
      render(
        <IpPolicyDialog
          open
          mode={mode}
          initialName="Office"
          initialEntries={['::ffff:203.0.113.42/128']}
          onOpenChange={vi.fn()}
          onSubmit={onSubmit}
        />,
      )
      await user.click(screen.getByRole('button', { name: mode === 'create' ? 'Create' : 'Save' }))
      expect(onSubmit).toHaveBeenCalledWith({
        name: 'Office',
        allowed_cidrs: ['::ffff:203.0.113.42/128'],
      })
    },
  )
})
