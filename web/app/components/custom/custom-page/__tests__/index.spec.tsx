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

vi.mock('@/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/config')>()
  return {
    ...actual,
  }
})

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

const { mockToast } = vi.hoisted(() => {
  const mockToast = Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    dismiss: vi.fn(),
    update: vi.fn(),
    promise: vi.fn(),
  })
  return { mockToast }
})

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: mockToast,
}))

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
    it('should render the custom brand configuration by default', () => {
      render(<CustomPage />)

      expect(screen.getByText('custom.webapp.removeBrand')).toBeInTheDocument()
      expect(screen.getByText('Chatflow App')).toBeInTheDocument()
      expect(screen.queryByText('custom.upgradeTip.title')).not.toBeInTheDocument()
      expect(screen.queryByText('custom.customize.contactUs')).not.toBeInTheDocument()
    })

    it('should show the upgrade banner and open pricing modal for sandbox billing', async () => {
      deploymentEdition = 'CLOUD'
      const user = userEvent.setup()
      plan = 'sandbox'
      canReplaceLogo = false

      render(<CustomPage />)

      expect(screen.getByText('custom.upgradeTip.title')).toBeInTheDocument()
      expect(screen.queryByText('custom.customize.contactUs')).not.toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'billing.upgradeBtn.encourageShort' }))

      await waitFor(() =>
        expect(onPricingUrlUpdate.mock.lastCall?.[0].searchParams.get('pricing')).toBe('open'),
      )
    })

    it('should show the contact link for professional workspaces', () => {
      deploymentEdition = 'CLOUD'
      canReplaceLogo = true

      render(<CustomPage />)

      const contactLink = screen.getByText('custom.customize.contactUs').closest('a')
      expect(screen.queryByText('custom.upgradeTip.title')).not.toBeInTheDocument()
      expect(contactLink).toHaveAttribute('href', contactSalesUrl)
      expect(contactLink).toHaveAttribute('target', '_blank')
      expect(contactLink).toHaveAttribute('rel', 'noopener noreferrer')
    })

    it('should show the contact link for team workspaces', () => {
      plan = 'team'
      deploymentEdition = 'CLOUD'
      canReplaceLogo = true

      render(<CustomPage />)

      expect(screen.getByText('custom.customize.contactUs')).toBeInTheDocument()
      expect(screen.queryByText('custom.upgradeTip.title')).not.toBeInTheDocument()
    })

    it('should hide both billing sections for Community deployments', () => {
      canReplaceLogo = false

      render(<CustomPage />)

      expect(screen.queryByText('custom.upgradeTip.title')).not.toBeInTheDocument()
      expect(screen.queryByText('custom.customize.contactUs')).not.toBeInTheDocument()
    })
  })
})
