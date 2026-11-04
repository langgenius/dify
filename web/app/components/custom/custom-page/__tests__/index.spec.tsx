import type { CloudPlan } from '@dify/contracts/api/console/features/types.gen'
import type { GetSystemFeaturesResponse } from '@dify/contracts/api/console/system-features/types.gen'
import type { ReactElement } from 'react'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { contactSalesUrl } from '@/app/components/billing/config'
import { consoleQuery } from '@/service/console'
import {
  createConsoleQueryClient,
  renderWithConsoleQuery as renderWithoutPricing,
} from '@/test/console/query-data'
import CustomPage from '../index'

const onPricingUrlUpdate = vi.hoisted(() => vi.fn())

let deploymentEdition: GetSystemFeaturesResponse['deployment_edition'] = 'COMMUNITY'
let canReplaceLogo = true
let plan: CloudPlan = 'professional'

function renderWithData(ui: ReactElement) {
  const queryClient = createConsoleQueryClient()
  queryClient.setQueryData(consoleQuery.workspaces.customConfig.get.queryKey(), {
    remove_webapp_brand: false,
    replace_webapp_logo: null,
  })

  return renderWithoutPricing(ui, {
    queryClient,
    features: {
      can_replace_logo: canReplaceLogo,
      billing: { subscription: { plan } },
    },
    systemFeatures: {
      deployment_edition: deploymentEdition,
      branding: {
        enabled: true,
        workspace_logo: 'https://example.com/workspace-logo.png',
      },
    },
  })
}

function render(...args: Parameters<typeof renderWithData>) {
  args[0] = <NuqsTestingAdapter onUrlUpdate={onPricingUrlUpdate}>{args[0]}</NuqsTestingAdapter>
  return renderWithData(...args)
}

describe('CustomPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    deploymentEdition = 'COMMUNITY'
    canReplaceLogo = true
    plan = 'professional'
  })

  // Integration coverage for the page and its child custom brand section.
  describe('Rendering', () => {
    it('should show the upgrade banner and open pricing modal for sandbox billing', async () => {
      deploymentEdition = 'CLOUD'
      const user = userEvent.setup()
      plan = 'sandbox'
      canReplaceLogo = false

      render(<CustomPage />)

      expect(
        screen.getByRole('heading', { level: 4, name: 'custom.upgradeTip.title' }),
      ).toBeInTheDocument()
      expect(screen.queryByText('custom.customize.contactUs')).not.toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'billing.upgradeBtn.encourageShort' }))

      await waitFor(() =>
        expect(onPricingUrlUpdate.mock.lastCall?.[0].searchParams.get('pricing')).toBe('open'),
      )
    })

    it.each(['professional', 'team'] as const)(
      'shows the contact link for %s workspaces',
      (workspacePlan) => {
        plan = workspacePlan
        deploymentEdition = 'CLOUD'
        canReplaceLogo = true

        render(<CustomPage />)

        const contactLink = screen.getByRole('link', { name: 'custom.customize.contactUs' })
        expect(screen.queryByText('custom.upgradeTip.title')).not.toBeInTheDocument()
        expect(contactLink).toHaveAttribute('href', contactSalesUrl)
        expect(contactLink).toHaveAttribute('target', '_blank')
        expect(contactLink).toHaveAttribute('rel', 'noopener noreferrer')
      },
    )

    it.each([true, false])('hides billing for Community when logo replacement is %s', (enabled) => {
      canReplaceLogo = enabled

      render(<CustomPage />)

      expect(screen.queryByText('custom.upgradeTip.title')).not.toBeInTheDocument()
      expect(screen.queryByText('custom.customize.contactUs')).not.toBeInTheDocument()
    })
  })
})
