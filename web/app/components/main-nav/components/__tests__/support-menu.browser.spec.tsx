import type { CloudPlan } from '@dify/contracts/api/console/features/types.gen'
import { Menu, MenuContent, MenuTrigger } from '@langgenius/dify-ui/menu'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { zendeskRuntime } from '@/app/components/base/zendesk/runtime'
import { consoleQuery } from '@/service/console'
import { seedFeatures, seedSystemFeatures } from '@/test/console/query-data'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { createTestQueryClient } from '@/test/query-client'
import ContactSupport from '../contact-support'
import SupportMenu from '../support-menu'

const boundary = vi.hoisted(() => ({
  config: {
    zendeskWidgetKey: 'zendesk-key',
  },
  openZendesk: vi.fn(),
  pricingUpdates: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('@/app/components/base/zendesk/runtime', () => ({
  zendeskRuntime: { open: boundary.openZendesk },
}))

vi.mock('@/app/notifications', () => ({ toast: { error: boundary.toastError } }))

vi.mock('@/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/config')>()
  const dynamicZendeskWidgetKey = {
    trim: () => boundary.config.zendeskWidgetKey.trim(),
  }
  return {
    ...actual,
    SUPPORT_EMAIL_ADDRESS: 'help@example.com',
    get ZENDESK_WIDGET_KEY() {
      return dynamicZendeskWidgetKey
    },
  }
})

async function renderSupportMenu({
  edition = 'CLOUD',
  plan = 'team',
}: {
  edition?: 'COMMUNITY' | 'ENTERPRISE' | 'CLOUD'
  plan?: CloudPlan | null
} = {}) {
  const queryClient = createTestQueryClient(() => new Promise(() => {}))
  seedSystemFeatures(queryClient, { deployment_edition: edition })
  if (plan !== null) {
    seedFeatures(queryClient, { billing: { subscription: { plan } } })
  } else {
    void queryClient.query({
      ...consoleQuery.features.get.queryOptions(),
      queryFn: () => new Promise(() => {}),
    })
  }

  const screen = await render(
    <QueryClientTestProvider queryClient={queryClient}>
      <NuqsTestingAdapter onUrlUpdate={boundary.pricingUpdates}>
        <ContactSupport placement="sidebar" />
        <Menu>
          <MenuTrigger>Support</MenuTrigger>
          <MenuContent>
            <SupportMenu />
          </MenuContent>
        </Menu>
      </NuqsTestingAdapter>
    </QueryClientTestProvider>,
  )
  const trigger = screen.getByRole('button', { name: 'Support' })
  await userEvent.click(trigger)
  await expect.element(screen.getByRole('menu')).toBeVisible()
  return { queryClient, screen, trigger }
}

beforeEach(() => {
  vi.clearAllMocks()
  boundary.config.zendeskWidgetKey = 'zendesk-key'
  boundary.openZendesk.mockResolvedValue(undefined)
})

it('opens Zendesk from the paid sidebar and keeps contact support out of Help', async () => {
  const { screen } = await renderSupportMenu()
  const contact = screen.getByRole('button', { name: 'common.userProfile.contactSupport' })
  const discord = screen.getByRole('menuitem', { name: 'common.userProfile.discord' })
  await expect.element(contact).toBeVisible()
  await expect.element(discord).toHaveAttribute('href', 'https://discord.gg/5AEfbxcd9k')
  await expect
    .element(screen.getByRole('menuitem', { name: 'common.userProfile.contactSupport' }))
    .not.toBeInTheDocument()

  await userEvent.keyboard('{Escape}')
  await expect.element(screen.getByRole('menu')).not.toBeInTheDocument()
  await userEvent.click(contact)

  expect(zendeskRuntime.open).toHaveBeenCalledWith('CLOUD')
})

it('surfaces a failed Zendesk launch and permits a fresh retry', async () => {
  boundary.openZendesk.mockRejectedValueOnce(new Error('load failed'))
  const { screen } = await renderSupportMenu()
  await userEvent.keyboard('{Escape}')
  await expect.element(screen.getByRole('menu')).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'common.userProfile.contactSupport' }))
  expect(boundary.toastError).toHaveBeenCalledWith('common.api.actionFailed')

  await userEvent.click(screen.getByRole('button', { name: 'common.userProfile.contactSupport' }))
  expect(boundary.openZendesk).toHaveBeenCalledTimes(2)
})

it('routes a sandbox to the existing pricing flow', async () => {
  const { screen } = await renderSupportMenu({ plan: 'sandbox' })
  const upgrade = screen.getByRole('menuitem', {
    name: 'common.userProfile.contactSupport billing.upgradeBtn.encourageShort',
  })
  await expect
    .element(screen.getByRole('button', { name: 'common.userProfile.contactSupport' }))
    .not.toBeInTheDocument()
  await expect
    .element(screen.getByRole('link', { name: 'common.userProfile.emailSupport' }))
    .not.toBeInTheDocument()

  await userEvent.click(upgrade)

  expect(boundary.pricingUpdates.mock.lastCall?.[0].searchParams.get('pricing')).toBe('open')
  expect(zendeskRuntime.open).not.toHaveBeenCalled()
})

it('does not show email support in Cloud when Zendesk is unavailable', async () => {
  boundary.config.zendeskWidgetKey = ''
  const { screen } = await renderSupportMenu()

  await expect
    .element(screen.getByRole('button', { name: 'common.userProfile.contactSupport' }))
    .not.toBeInTheDocument()
  await expect
    .element(screen.getByRole('link', { name: 'common.userProfile.emailSupport' }))
    .not.toBeInTheDocument()
})

it('waits for the Cloud plan before revealing paid contact support', async () => {
  const { queryClient, screen } = await renderSupportMenu({ plan: null })
  await expect
    .element(screen.getByRole('button', { name: 'common.userProfile.contactSupport' }))
    .not.toBeInTheDocument()
  await expect
    .element(screen.getByRole('menuitem', { name: 'common.userProfile.discord' }))
    .toBeVisible()

  seedFeatures(queryClient, { billing: { subscription: { plan: 'team' } } })

  await expect
    .element(screen.getByRole('button', { name: 'common.userProfile.contactSupport' }))
    .toBeVisible()
})

it('keeps configured email support in non-Cloud editions', async () => {
  const { screen } = await renderSupportMenu({ edition: 'COMMUNITY' })

  await expect
    .element(screen.getByRole('menuitem', { name: 'common.userProfile.emailSupport' }))
    .toHaveAttribute('href', 'mailto:help@example.com')
})
