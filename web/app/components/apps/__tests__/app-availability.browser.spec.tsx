import type { AppPartial } from '@dify/contracts/api/console/apps/types.gen'
import type { AnchorHTMLAttributes } from 'react'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { AppCard } from '../app-card'
import { StarredAppCard } from '../starred-app-card'

vi.mock('react-i18next', async () => {
  const { createReactI18nextMock } = await import('@/test/i18n-mock')
  const { default: app } = await import('@/i18n/locales/en-US/app.json')
  const { default: common } = await import('@/i18n/locales/en-US/common.json')
  const { default: time } = await import('@/i18n/locales/en-US/time.json')
  return createReactI18nextMock(
    Object.fromEntries(
      Object.entries({ app, common, time }).flatMap(([namespace, resource]) =>
        Object.entries(resource).map(([key, value]) => [`${namespace}.${key}`, value]),
      ),
    ),
  )
})

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))
vi.mock('@/next/link', () => ({
  default: ({ children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a {...props}>{children}</a>
  ),
}))

it.each([AppCard, StarredAppCard])(
  'opens card details without navigation and keeps every reason reachable',
  async (Card) => {
    // Native hit testing catches the card link covering its details trigger.
    // Real geometry/scrolling catch clipped reasons that happy-dom cannot detect.
    await page.viewport(390, 844)
    const app: AppPartial = {
      id: 'repair',
      name: 'Repairable customer-support workflow with a long name',
      mode: 'workflow',
      icon_url: null,
      permission_keys: ['app.edit'],
      author_name: 'Workspace owner',
      updated_at: 1792000000,
      availability: 'unavailable',
      availability_source: 'published',
      availability_reasons: Array.from({ length: 30 }, (_, index) => ({
        type: 'model',
        reason: 'disabled',
        resource_id: `node-${index}`,
        provider: 'organization/provider-with-a-very-long-identifier',
        model: 'model-with-a-long-configuration-name',
      })),
    }
    const { queryClient, wrapper: Wrapper } = createConsoleQueryWrapper({
      workspacePermissionKeys: ['app.create_and_management'],
      systemFeatures: { webapp_auth: { enabled: false } },
    })
    queryClient.setQueryData(
      consoleQuery.tags.get.queryKey({ input: { query: { type: 'app' } } }),
      [],
    )
    const screen = await render(
      <Wrapper>
        <ul className="w-full p-4">
          <Card app={app} />
        </ul>
      </Wrapper>,
    )
    const trigger = screen.getByRole('button', {
      name: `Availability details for ${app.name}`,
    })
    await expect.element(trigger).toBeVisible()
    await trigger.click()
    const popup = screen.getByRole('dialog', { name: app.name })
    await expect.element(popup).toBeVisible()
    await expect.element(screen.getByRole('link', { name: app.name })).toBeVisible()
    const badge = screen.getByText('Unavailable', { exact: true })
    const badgeBounds = badge.element().getBoundingClientRect()
    expect(
      badge
        .element()
        .contains(
          document.elementFromPoint(
            badgeBounds.left + badgeBounds.width / 2,
            badgeBounds.top + badgeBounds.height / 2,
          ),
        ),
    ).toBe(true)
    const bounds = popup.element().getBoundingClientRect()
    expect(bounds.left).toBeGreaterThanOrEqual(0)
    expect(bounds.right).toBeLessThanOrEqual(390)
    const region = screen.getByRole('region', {
      name: `Availability details for ${app.name}`,
    })
    region.element().focus()
    await expect.element(region).toHaveFocus()
    await userEvent.keyboard('{End}')
    await vi.waitFor(() => {
      const viewport = region.element()
      expect(viewport.scrollTop).toBeGreaterThan(0)
      const last = screen
        .getByText(/node-29$/)
        .element()
        .getBoundingClientRect()
      expect(last.bottom).toBeLessThanOrEqual(viewport.getBoundingClientRect().bottom + 1)
    })
    await userEvent.keyboard('{Escape}')
    await expect.element(popup).not.toBeInTheDocument()
    await expect.element(trigger).toHaveFocus()
    queryClient.clear()
  },
)
