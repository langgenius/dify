import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import plugin from '@/i18n/locales/en-US/plugin.json'
import CategoryEmptyState from '../category-empty-state'

// Keep the production Trans parser: the default test mock does not render named components.
vi.unmock('react-i18next')

beforeEach(async () => {
  await page.viewport(800, 600)
})

it.each([
  {
    category: 'trigger',
    label: plugin['list.noTriggerFound'],
    categoryLabel: plugin['category.triggers'],
    href: '#plugin-category-marketplace-trigger',
  },
  {
    category: 'agent-strategy',
    label: plugin['list.noAgentStrategyFound'],
    categoryLabel: plugin['category.agents'],
    href: '#plugin-category-marketplace-agent-strategy',
  },
  {
    category: 'extension',
    label: plugin['list.noExtensionFound'],
    categoryLabel: plugin['category.extensions'],
    href: '#plugin-category-marketplace-extension',
  },
] as const)(
  'offers the $category marketplace inside the translated empty-state sentence',
  async ({ category, label, categoryLabel, href }) => {
    const i18n = createInstance()
    await i18n.init({
      lng: 'en-US',
      resources: { 'en-US': { plugin } },
      keySeparator: false,
      interpolation: { escapeValue: false },
    })
    await render(
      <I18nextProvider i18n={i18n}>
        <CategoryEmptyState category={category} showMarketplaceLink />
      </I18nextProvider>,
    )

    await expect.element(page.getByText(label)).toBeVisible()
    await expect
      .element(page.getByText(`You can install ${categoryLabel} from the Marketplace.`))
      .toBeVisible()
    const link = page.getByRole('link', { name: 'Marketplace', exact: true })
    await expect.element(link).toHaveAttribute('href', href)
    await userEvent.tab()
    await expect.element(link).toHaveFocus()
  },
)

it('omits install entries when marketplace access is disabled', async () => {
  const i18n = createInstance()
  await i18n.init({ lng: 'en-US', resources: { 'en-US': { plugin } }, keySeparator: false })
  await render(
    <I18nextProvider i18n={i18n}>
      <CategoryEmptyState category="trigger" showMarketplaceLink={false} />
    </I18nextProvider>,
  )

  await expect.element(page.getByText(plugin['list.noTriggerFound'])).toBeVisible()
  await expect.element(page.getByRole('link')).not.toBeInTheDocument()
  await expect.element(page.getByText(plugin['source.github'])).not.toBeInTheDocument()
  await expect.element(page.getByText(plugin['source.local'])).not.toBeInTheDocument()
})
