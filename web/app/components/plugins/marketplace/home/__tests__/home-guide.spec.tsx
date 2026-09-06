import { TooltipProvider } from '@langgenius/dify-ui/tooltip'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import HomeGuide from '../home-guide'

const mocks = vi.hoisted(() => ({
  marketplaceUrlPrefix: 'https://marketplace.dify.ai',
  useDocLink: vi.fn(() => (path?: string) => `https://docs.dify.ai/console${path || ''}`),
}))

vi.mock('#i18n', async () => {
  const { withSelectorKey } = await import('@/test/i18n-mock')
  return {
    useTranslation: () => ({
      i18n: {
        language: 'en-US',
      },
      t: withSelectorKey((key: string) => key),
    }),
  }
})

vi.mock('@/context/i18n', () => ({
  defaultDocBaseUrl: 'https://docs.dify.ai',
  useDocLink: mocks.useDocLink,
}))

vi.mock('@/config', () => ({
  get MARKETPLACE_URL_PREFIX() {
    return mocks.marketplaceUrlPrefix
  },
}))

const GUIDE_BUTTON_NAME = /marketplace\.home\.guide/

const renderGuide = (isMarketplacePlatform: boolean) =>
  render(
    <TooltipProvider delay={0} closeDelay={0}>
      <HomeGuide isMarketplacePlatform={isMarketplacePlatform} />
    </TooltipProvider>,
  )

const openGuideMenu = async (isMarketplacePlatform: boolean) => {
  const user = userEvent.setup()
  renderGuide(isMarketplacePlatform)

  expect(screen.queryByRole('link', { name: 'marketplace.home.guide' })).not.toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: GUIDE_BUTTON_NAME }))
  return within(await screen.findByRole('menu'))
}

describe('HomeGuide', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.marketplaceUrlPrefix = 'https://marketplace.dify.ai'
  })

  it('opens a four-option dropdown on the standalone Marketplace instead of navigating away', async () => {
    const menu = await openGuideMenu(true)
    const options = menu.getAllByRole('menuitem')

    expect(options).toHaveLength(4)
    expect(options[0]).toHaveAttribute(
      'href',
      'https://github.com/langgenius/dify-plugins/issues/new?template=plugin_request.yaml',
    )
    expect(options[1]).toHaveAttribute(
      'href',
      'https://docs.dify.ai/en/develop-plugin/getting-started/getting-started-dify-plugin',
    )
    expect(options[2]).toHaveAttribute(
      'href',
      'https://docs.dify.ai/en/develop-plugin/publishing/marketplace-listing/release-overview',
    )
    expect(options[3]).toHaveAttribute('href', 'https://creators.dify.ai')
    expect(mocks.useDocLink).not.toHaveBeenCalled()
  })

  it('uses Dify deployment-aware documentation links inside the console', async () => {
    const menu = await openGuideMenu(false)
    const options = menu.getAllByRole('menuitem')

    expect(options).toHaveLength(4)
    expect(options[1]).toHaveAttribute(
      'href',
      'https://docs.dify.ai/console/develop-plugin/getting-started/getting-started-dify-plugin',
    )
    expect(options[2]).toHaveAttribute(
      'href',
      'https://docs.dify.ai/console/develop-plugin/publishing/marketplace-listing/release-overview',
    )
    expect(mocks.useDocLink).toHaveBeenCalledOnce()
  })

  it('labels the in-app Guide icon and shows a matching tooltip on hover and focus', async () => {
    const user = userEvent.setup()
    renderGuide(false)

    const trigger = screen.getByRole('button', { name: GUIDE_BUTTON_NAME })
    expect(trigger).toHaveAccessibleName(/marketplace\.home\.guide/)

    await user.hover(trigger)
    expect(await screen.findByRole('tooltip')).toHaveTextContent(/marketplace\.home\.guide/)

    await user.unhover(trigger)
    await waitFor(() => {
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    })

    await user.tab()
    expect(trigger).toHaveFocus()
    expect(await screen.findByRole('tooltip')).toHaveTextContent(/marketplace\.home\.guide/)
  })

  it('keeps the Guide dropdown available after the tooltip is shown', async () => {
    const user = userEvent.setup()
    renderGuide(false)

    const trigger = screen.getByRole('button', { name: GUIDE_BUTTON_NAME })
    await user.hover(trigger)
    expect(await screen.findByRole('tooltip')).toBeInTheDocument()

    await user.click(trigger)
    expect(await screen.findByRole('menu')).toBeInTheDocument()
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })
})
