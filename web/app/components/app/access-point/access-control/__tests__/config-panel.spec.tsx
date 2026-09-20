import type { AccessControlDraft, AccessControlPolicy } from '../draft'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { ACCESS_POINT_ORDER } from '@/app/components/app/deploy/utils/access-point'
import { render } from '@/test/console/render'
import { AccessControlConfigPanel } from '../config-panel'
import { createDefaultAccessControlDraft } from '../draft'

const policies: AccessControlPolicy[] = [
  {
    id: 'internal-network',
    name: 'Internal Network',
    allowed_cidrs: ['203.0.113.42/32', '198.51.100.0/24', '192.0.2.1/32', '192.0.2.2/32'],
  },
  {
    id: 'office-vpn',
    name: 'Office VPN',
    allowed_cidrs: ['198.51.100.0/24'],
  },
]

const translations = vi.hoisted(() => ({
  'operation.cancel': 'Cancel',
  'operation.save': 'Save',
  'overview.apiInfo.title': 'Backend Service API',
  'overview.appInfo.title': 'Web App',
  'mcp.server.title': 'MCP Server',
  'settings.ipPolicies': 'IP Policies',
  'settings.trigger': 'Trigger',
}))

vi.mock('react-i18next', async () => {
  const { createReactI18nextMock } = await import('@/test/i18n-mock')
  const { default: deploymentTranslations } = await import('@/i18n/en-US/deployments.json')
  return createReactI18nextMock({ ...translations, ...deploymentTranslations })
})

function PanelHarness({
  currentIp,
  initialDraft = createDefaultAccessControlDraft(ACCESS_POINT_ORDER),
  onSave = vi.fn(),
  onCreatePolicy = vi.fn(),
  onManagePolicies = vi.fn(),
  canManagePolicies = true,
  readOnly = false,
}: {
  currentIp?: string
  initialDraft?: AccessControlDraft
  onSave?: () => void
  onCreatePolicy?: () => void
  onManagePolicies?: () => void
  canManagePolicies?: boolean
  readOnly?: boolean
}) {
  const [draft, setDraft] = useState(initialDraft)
  const onCancel = vi.fn()

  return (
    <Popover open>
      <PopoverTrigger>Access Control</PopoverTrigger>
      <PopoverContent>
        <AccessControlConfigPanel
          draft={draft}
          availableAccessPoints={ACCESS_POINT_ORDER}
          appIcon={{}}
          canManagePolicies={canManagePolicies}
          readOnly={readOnly}
          policies={policies}
          currentIp={currentIp}
          onCancel={onCancel}
          onCreatePolicy={onCreatePolicy}
          onManagePolicies={onManagePolicies}
          onDraftChange={setDraft}
          onSave={onSave}
        />
      </PopoverContent>
    </Popover>
  )
}

describe('AccessControlConfigPanel', () => {
  it('opens the policy select when policies exist and none is selected', async () => {
    render(<PanelHarness />)

    expect(await screen.findByRole('option', { name: /Internal Network/ })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'IP Policy' })).toHaveAccessibleDescription(
      'Please select an IP policy.',
    )
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(screen.getByRole('switch', { name: 'Web App' })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(screen.getByRole('switch', { name: 'Backend Service API' })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(screen.getByRole('switch', { name: 'MCP Server' })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(screen.getByRole('switch', { name: 'Trigger' })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    )
  })

  it('enables save after a policy is selected', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(<PanelHarness onSave={onSave} />)

    await user.click(await screen.findByRole('option', { name: /Internal Network/ }))

    expect(screen.queryByText('Please select an IP policy.')).not.toBeInTheDocument()
    expect(
      screen.getByText('Allows 203.0.113.42/32, 198.51.100.0/24 and 2 more addresses'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
    expect(screen.getByRole('switch', { name: 'Web App' })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    )

    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it.each([null, 'internal-network'])(
    'opens policy creation from the policy list with selected policy %s',
    async (selectedPolicyId) => {
      const user = userEvent.setup()
      const onCreatePolicy = vi.fn()
      const onManagePolicies = vi.fn()
      render(
        <PanelHarness
          initialDraft={{
            ...createDefaultAccessControlDraft(ACCESS_POINT_ORDER),
            selectedPolicyId,
          }}
          onCreatePolicy={onCreatePolicy}
          onManagePolicies={onManagePolicies}
        />,
      )

      if (selectedPolicyId) {
        await user.click(screen.getByRole('combobox', { name: 'IP Policy' }))
        await user.click(await screen.findByRole('option', { name: 'Add IP Policy' }))
      } else {
        await user.click(screen.getByRole('button', { name: 'Add IP Policy' }))
      }

      expect(onCreatePolicy).toHaveBeenCalledOnce()
      expect(onManagePolicies).not.toHaveBeenCalled()
    },
  )

  it.each([{ canManagePolicies: false }, { readOnly: true }])(
    'keeps policy creation unavailable without edit permission: %j',
    (permissions) => {
      render(<PanelHarness {...permissions} />)

      expect(screen.queryByRole('button', { name: 'Add IP Policy' })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Manage IP policies' })).toBeEnabled()
    },
  )

  it('hides required-selection messages while access control is disabled', () => {
    render(
      <PanelHarness
        initialDraft={{
          enabled: false,
          selectedPolicyId: null,
          scopes: { webApp: false, serviceApi: false, mcp: false, trigger: false },
        }}
      />,
    )

    expect(screen.queryByText('Please select an IP policy.')).not.toBeInTheDocument()
    expect(screen.queryByText('Please choose at least one access point.')).not.toBeInTheDocument()
  })

  it('warns and disables save when every access point is off', async () => {
    const user = userEvent.setup()
    render(<PanelHarness />)

    await user.click(await screen.findByRole('option', { name: /Internal Network/ }))
    await user.click(screen.getByRole('switch', { name: 'Web App' }))
    await user.click(screen.getByRole('switch', { name: 'Backend Service API' }))
    await user.click(screen.getByRole('switch', { name: 'MCP Server' }))
    await user.click(screen.getByRole('switch', { name: 'Trigger' }))

    expect(screen.getByText('Please choose at least one access point.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('shows a lockout warning when the current IP is outside the selected policy', async () => {
    const user = userEvent.setup()
    render(<PanelHarness currentIp="203.0.113.42" />)

    await user.click(await screen.findByRole('option', { name: /Office VPN/ }))

    expect(
      screen.getByText("Your IP (203.0.113.42) isn't in this policy. You may lose access."),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
  })

  it('lets the user turn any access point off without a Not enabled label', async () => {
    const user = userEvent.setup()
    render(
      <PanelHarness
        initialDraft={{
          ...createDefaultAccessControlDraft(ACCESS_POINT_ORDER),
          selectedPolicyId: 'internal-network',
          enabled: true,
        }}
      />,
    )

    expect(screen.queryByText('Not enabled')).not.toBeInTheDocument()
    await user.click(screen.getByRole('switch', { name: 'MCP Server' }))
    expect(screen.getByRole('switch', { name: 'MCP Server' })).not.toBeChecked()
    await user.click(screen.getByRole('switch', { name: 'Trigger' }))
    expect(screen.getByRole('switch', { name: 'Trigger' })).not.toBeChecked()
  })
})
