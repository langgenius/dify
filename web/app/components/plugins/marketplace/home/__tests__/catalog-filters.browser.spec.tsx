import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createNuqsTestWrapper } from '@/test/nuqs-testing'
import CatalogLanguagesFilter from '../catalog-languages-filter'
import CatalogTagsFilter from '../catalog-tags-filter'

vi.mock('#i18n', async () => {
  const { createReactI18nextMock } = await import('@/test/i18n-mock')
  return {
    ...createReactI18nextMock({
      clearSearch: 'Clear {{label}}',
      'marketplace.languages': 'Languages',
      'marketplace.searchFilterLanguage': 'Search languages',
      'pluginTags.allTags': 'All tags',
      'pluginTags.clearSelectedTags': 'Clear {{tags}}',
      'pluginTags.searchTags': 'Search tags',
    }),
    useLocale: () => 'en-US',
  }
})

vi.mock('react-i18next', async (importOriginal) => {
  const original = await importOriginal<typeof import('react-i18next')>()
  const { createReactI18nextMock } = await import('@/test/i18n-mock')
  return {
    ...original,
    ...createReactI18nextMock({
      'pluginTags.allTags': 'All tags',
      'pluginTags.clearSelectedTags': 'Clear {{tags}}',
      'pluginTags.searchTags': 'Search tags',
      'pluginTags.tags.agent': 'Agent',
      'pluginTags.tags.rag': 'RAG',
      'pluginTags.tags.search': 'Search',
    }),
  }
})

async function renderFilters(searchParams = '') {
  const { wrapper: UrlState, onUrlUpdate } = createNuqsTestWrapper({
    hasMemory: true,
    searchParams,
  })
  const screen = await render(
    <UrlState>
      <div aria-label="Catalog filters" role="group">
        <CatalogLanguagesFilter />
        <CatalogTagsFilter />
      </div>
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
    const trigger = screen.getByRole('button', { name: 'Languages' })

    await trigger.click()
    const search = screen.getByRole('searchbox', { name: 'Search languages' })
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
    await expect.element(screen.getByRole('button', { name: 'Languages' })).toHaveFocus()
    await expect
      .poll(() => onUrlUpdate.mock.calls.at(-1)?.[0].searchParams.has('languages'))
      .toBe(false)
  })

  it('filters real tag options, preserves multiple selections, and restores focus after clearing', async () => {
    const { onUrlUpdate, screen } = await renderFilters()
    const trigger = screen.getByRole('button', { name: 'All tags' })

    await trigger.click()
    const search = screen.getByRole('searchbox', { name: 'Search tags' })
    await expect.element(search).toHaveFocus()
    await search.fill('agent')
    await screen.getByRole('checkbox', { name: 'Agent' }).click()

    await expect.element(screen.getByRole('button', { name: 'Agent' })).toBeVisible()
    await expect
      .poll(() => onUrlUpdate.mock.calls.at(-1)?.[0].searchParams.get('tags'))
      .toBe('agent')
    await expect.element(screen.getByRole('checkbox', { name: 'Agent' })).toBeChecked()

    await userEvent.keyboard('{Escape}')
    await screen.getByRole('button', { name: 'Clear Agent' }).click()
    await expect.element(screen.getByRole('button', { name: 'All tags' })).toHaveFocus()
    await expect.poll(() => onUrlUpdate.mock.calls.at(-1)?.[0].searchParams.has('tags')).toBe(false)
  })
})
