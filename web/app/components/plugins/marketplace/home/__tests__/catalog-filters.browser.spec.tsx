import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import pluginTags from '@/i18n/locales/en-US/plugin-tags.json'
import plugin from '@/i18n/locales/en-US/plugin.json'
import { createNuqsTestWrapper } from '@/test/nuqs-testing'
import CatalogLanguagesFilter from '../catalog-languages-filter'
import CatalogTagsFilter from '../catalog-tags-filter'

vi.unmock('react-i18next')

async function renderFilters(searchParams = '') {
  const i18n = createInstance()
  await i18n.init({
    lng: 'en-US',
    keySeparator: false,
    resources: { 'en-US': { plugin, pluginTags } },
  })
  const { wrapper: UrlState, onUrlUpdate } = createNuqsTestWrapper({
    hasMemory: true,
    searchParams,
  })
  const screen = await render(
    <UrlState>
      <I18nextProvider i18n={i18n}>
        <div aria-label="Catalog filters" role="group">
          <CatalogLanguagesFilter />
          <CatalogTagsFilter />
        </div>
      </I18nextProvider>
    </UrlState>,
  )
  return { onUrlUpdate, screen }
}

describe('Marketplace catalog filters', () => {
  beforeEach(async () => {
    await page.viewport(1000, 700)
    vi.clearAllMocks()
  })

  it('keeps selected languages visible and restores focus after clearing', async () => {
    const { onUrlUpdate, screen } = await renderFilters()
    const trigger = screen.getByRole('button', { name: 'Filter by Languages' })

    await trigger.click()
    const search = screen.getByRole('searchbox', { name: 'Search language' })
    await expect.element(search).toHaveFocus()
    await search.fill('中文')
    await screen.getByRole('checkbox', { name: '中文' }).click()

    await expect.element(screen.getByRole('button', { name: '中文' })).toBeVisible()
    await expect
      .poll(() => onUrlUpdate.mock.calls.at(-1)?.[0].searchParams.get('languages'))
      .toBe('zh-Hans')
    await expect.element(screen.getByRole('checkbox', { name: '中文' })).toBeChecked()

    await userEvent.keyboard('{Escape}')
    const clear = screen.getByRole('button', { name: 'Clear 中文' })
    await clear.click()
    await expect.element(screen.getByRole('button', { name: 'Filter by Languages' })).toHaveFocus()
    await expect
      .poll(() => onUrlUpdate.mock.calls.at(-1)?.[0].searchParams.has('languages'))
      .toBe(false)
  })

  it('filters real tag options, preserves multiple selections, and restores focus after clearing', async () => {
    const { onUrlUpdate, screen } = await renderFilters()
    const trigger = screen.getByRole('button', { name: 'All Tags' })

    await trigger.click()
    const search = screen.getByRole('searchbox', { name: 'Search Tags' })
    await expect.element(search).toHaveFocus()
    await search.fill('agent')
    await screen.getByRole('checkbox', { name: 'Agent' }).click()

    await expect.element(screen.getByRole('button', { name: 'Agent' })).toBeVisible()
    await expect
      .poll(() => onUrlUpdate.mock.calls.at(-1)?.[0].searchParams.get('tags'))
      .toBe('agent')
    await expect.element(screen.getByRole('checkbox', { name: 'Agent' })).toBeChecked()

    await userEvent.keyboard('{Escape}')
    await screen.getByRole('button', { name: 'Clear selected tags: Agent' }).click()
    await expect.element(screen.getByRole('button', { name: 'All Tags' })).toHaveFocus()
    await expect.poll(() => onUrlUpdate.mock.calls.at(-1)?.[0].searchParams.has('tags')).toBe(false)
  })
})
