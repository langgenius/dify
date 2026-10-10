import type { NetworkAccessGroupCurrentIpCheckResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { AccessControlDraft, AccessControlPolicy } from '../draft'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { useState } from 'react'
import { initReactI18next } from 'react-i18next'
import { ACCESS_POINT_ORDER } from '@/app/components/app/deploy/utils/access-point'
import appOverviewTranslations from '@/i18n/locales/en-US/app-overview.json'
import commonTranslations from '@/i18n/locales/en-US/common.json'
import deploymentTranslations from '@/i18n/locales/en-US/deployments.json'
import navigationTranslations from '@/i18n/locales/en-US/navigation.json'
import toolsTranslations from '@/i18n/locales/en-US/tools.json'
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

vi.unmock('react-i18next')

beforeEach(async () => {
  await createInstance()
    .use(initReactI18next)
    .init({
      lng: 'en-US',
      fallbackLng: 'en-US',
      keySeparator: false,
      interpolation: { escapeValue: false },
      resources: {
        'en-US': {
          appOverview: appOverviewTranslations,
          common: commonTranslations,
          deployments: deploymentTranslations,
          navigation: navigationTranslations,
          tools: toolsTranslations,
        },
      },
    })
})

function PanelHarness({
  ipCheck,
  initialDraft = createDefaultAccessControlDraft(ACCESS_POINT_ORDER),
  onSave = vi.fn(),
  onCreatePolicy = vi.fn(),
  onManagePolicies = vi.fn(),
  canManagePolicies = true,
  readOnly = false,
  availablePolicies = policies,
}: {
  ipCheck?: NetworkAccessGroupCurrentIpCheckResponse
  initialDraft?: AccessControlDraft
  onSave?: () => void
  onCreatePolicy?: () => void
  onManagePolicies?: () => void
  canManagePolicies?: boolean
  readOnly?: boolean
  availablePolicies?: AccessControlPolicy[]
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
          policies={availablePolicies}
          ipCheck={ipCheck}
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
    expect(screen.getByRole('switch', { name: 'Web App' })).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('switch', { name: 'Backend Service API' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(screen.getByRole('switch', { name: 'MCP Server' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(screen.getByRole('switch', { name: 'Trigger' })).toHaveAttribute('aria-disabled', 'true')
  })

  it.each([
    { addressCount: 3, remainder: '1 more address' },
    { addressCount: 4, remainder: '2 more addresses' },
  ])(
    'summarizes $remainder and enables save after selecting a policy',
    async ({ addressCount, remainder }) => {
      const user = userEvent.setup()
      const onSave = vi.fn()
      render(
        <PanelHarness
          availablePolicies={policies.map((policy) => ({
            ...policy,
            allowed_cidrs: policy.allowed_cidrs.slice(0, addressCount),
          }))}
          onSave={onSave}
        />,
      )

      await user.click(await screen.findByRole('option', { name: /Internal Network/ }))

      expect(screen.queryByText('Please select an IP policy.')).not.toBeInTheDocument()
      expect(
        screen.getByText(`Allows 203.0.113.42/32, 198.51.100.0/24 and ${remainder}`),
      ).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
      expect(screen.getByRole('switch', { name: 'Web App' })).not.toHaveAttribute(
        'aria-disabled',
        'true',
      )

      await user.click(screen.getByRole('button', { name: 'Save' }))
      expect(onSave).toHaveBeenCalledTimes(1)
    },
  )

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
        await user.click(await screen.findByRole('option', { name: 'Create an IP policy' }))
      } else {
        await user.click(screen.getByRole('button', { name: 'Create an IP policy' }))
      }

      expect(onCreatePolicy).toHaveBeenCalledOnce()
      expect(onManagePolicies).not.toHaveBeenCalled()
    },
  )

  it.each([
    { canManagePolicies: false, manageLabel: 'View IP policies' },
    { readOnly: true, manageLabel: 'Manage IP policies' },
  ])(
    'keeps policy creation unavailable without edit permission: %j',
    ({ manageLabel, ...permissions }) => {
      render(<PanelHarness {...permissions} />)

      expect(screen.queryByRole('button', { name: 'Create an IP policy' })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: manageLabel })).toBeEnabled()
    },
  )

  it('lets editors open the read-only policy list with a View IP policies tooltip', async () => {
    const user = userEvent.setup()
    const onManagePolicies = vi.fn()
    render(<PanelHarness canManagePolicies={false} onManagePolicies={onManagePolicies} />)

    const viewPolicies = screen.getByRole('button', { name: 'View IP policies' })
    await user.hover(viewPolicies)
    expect(await screen.findByText('View IP policies')).toBeInTheDocument()
    await user.click(viewPolicies)
    expect(onManagePolicies).toHaveBeenCalledOnce()
  })

  it('requires access points when editing a paused policy', () => {
    render(
      <PanelHarness
        initialDraft={{
          enabled: false,
          selectedPolicyId: 'internal-network',
          scopes: { webApp: false, serviceApi: false, mcp: false, trigger: false },
        }}
      />,
    )

    expect(screen.queryByText('Please select an IP policy.')).not.toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Apply to' })).toHaveAccessibleDescription(
      'Please select at least one access point.',
    )
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('warns and disables save when every access point is off', async () => {
    const user = userEvent.setup()
    render(<PanelHarness />)

    await user.click(await screen.findByRole('option', { name: /Internal Network/ }))
    await user.click(screen.getByRole('switch', { name: 'Web App' }))
    await user.click(screen.getByRole('switch', { name: 'Backend Service API' }))
    await user.click(screen.getByRole('switch', { name: 'MCP Server' }))
    await user.click(screen.getByRole('switch', { name: 'Trigger' }))

    expect(screen.getByText('Please select at least one access point.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('shows a lockout warning when the current IP is outside the selected policy', async () => {
    const user = userEvent.setup()
    render(
      <PanelHarness ipCheck={{ allowed: false, client_ip: '203.0.113.42', policy_version: 1 }} />,
    )

    await user.click(await screen.findByRole('option', { name: /Office VPN/ }))

    expect(
      screen.getByText("Your IP (203.0.113.42) isn't in this policy. You may lose access."),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
  })

  it('lets the user turn any access point off without a Not protected label', async () => {
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

    expect(screen.queryByText('Not protected')).not.toBeInTheDocument()
    await user.click(screen.getByRole('switch', { name: 'MCP Server' }))
    expect(screen.getByRole('switch', { name: 'MCP Server' })).not.toBeChecked()
    await user.click(screen.getByRole('switch', { name: 'Trigger' }))
    expect(screen.getByRole('switch', { name: 'Trigger' })).not.toBeChecked()
  })
})

it('ignores pointer and keyboard scope changes until a policy is selected', async () => {
  const user = userEvent.setup()
  render(<PanelHarness />)
  const scope = screen.getByRole('switch', { name: 'Web App' })
  await user.click(scope)
  expect(scope).toBeChecked()
  expect(scope).toHaveAttribute('tabindex', '-1')
  scope.focus()
  await user.keyboard(' {Enter}')
  expect(scope).toBeChecked()
  await user.click(screen.getByRole('option', { name: /Internal Network/ }))
  await user.click(scope)
  expect(scope).not.toBeChecked()
})

it('requires a policy that is still present in the workspace before enabling configuration', () => {
  render(
    <PanelHarness
      initialDraft={{
        ...createDefaultAccessControlDraft(ACCESS_POINT_ORDER),
        selectedPolicyId: 'deleted-policy',
      }}
    />,
  )
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  expect(screen.getByRole('switch', { name: 'Web App' })).toHaveAttribute('aria-disabled', 'true')
})
