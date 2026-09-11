import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { renderWithNuqs } from '@/test/nuqs-testing'
import CatalogTagsFilter from '../catalog-tags-filter'

vi.mock('#i18n', async () => {
  const { withSelectorKey } = await import('@/test/i18n-mock')
  return {
    useTranslation: () => ({
      t: withSelectorKey((key: string, options?: { ns?: string }) =>
        options?.ns ? `${options.ns}.${key}` : key,
      ),
    }),
  }
})

vi.mock('@/app/components/plugins/hooks', () => ({
  useTags: () => ({
    tags: [
      { name: 'agent', label: 'Agent' },
      { name: 'rag', label: 'RAG' },
      { name: 'search', label: 'Search' },
    ],
    tagsMap: {
      agent: { name: 'agent', label: 'Agent' },
      rag: { name: 'rag', label: 'RAG' },
      search: { name: 'search', label: 'Search' },
    },
  }),
}))

describe('CatalogTagsFilter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('writes selected tags into the URL', async () => {
    const user = userEvent.setup()
    const { onUrlUpdate } = renderWithNuqs(<CatalogTagsFilter />)
    await user.click(screen.getByRole('button', { name: 'pluginTags.allTags' }))
    await user.click(screen.getByRole('checkbox', { name: 'Agent' }))
    await waitFor(() => {
      expect(onUrlUpdate.mock.calls.at(-1)?.[0].searchParams.get('tags')).toBe('agent')
    })
  })
})
