import type { CreatorCreation } from '../model'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { renderWithNuqs } from '@/test/nuqs-testing'
import CreatorContent from '../creator-content'

const publisherMocks = vi.hoisted(() => ({
  fetchPublisherPluginPage: vi.fn(),
  fetchPublisherTemplatePage: vi.fn(),
}))

vi.mock('../publisher', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../publisher')>()
  return {
    ...actual,
    fetchPublisherPluginPage: publisherMocks.fetchPublisherPluginPage,
    fetchPublisherTemplatePage: publisherMocks.fetchPublisherTemplatePage,
  }
})

vi.mock('#i18n', async () => {
  const { withSelectorKey } = await import('@/test/i18n-mock')
  const translations: Record<string, string> = {
    'marketplace.creatorProfile.creations': 'Creations',
    'marketplace.creatorProfile.sortBy': 'Sort by',
    'marketplace.creatorProfile.sort.updatedAt': 'Recently updated',
    'marketplace.creatorProfile.sort.createdAt': 'Recently created',
    'marketplace.creatorProfile.sort.popularity': 'Most popular',
    'marketplace.creatorProfile.sort.asc': 'Sort ascending',
    'marketplace.creatorProfile.sort.desc': 'Sort descending',
    'marketplace.creatorProfile.type.plugin': 'Plugin',
    'marketplace.creatorProfile.type.template': 'Template',
    'marketplace.creatorProfile.loadMore': 'Load more',
    'marketplace.creatorProfile.loadMoreFailed': "Couldn't load more creations.",
  }

  return {
    useTranslation: () => ({
      t: withSelectorKey((key: string) => translations[key] ?? key),
    }),
  }
})

vi.mock('@/app/components/base/app-icon', () => ({
  default: () => <span aria-hidden />,
}))

const createCreation = (
  id: string,
  title: string,
  updatedAt: number,
  createdAt: number,
  popularity: number,
): CreatorCreation => ({
  id,
  kind: 'plugin',
  title,
  description: `${title} description`,
  target: { type: 'plugin', pluginType: 'plugin', org: 'dify', name: id },
  icon: { type: 'emoji', value: 'P' },
  dependencyIcons: [],
  dependencyCount: 0,
  updatedAt,
  createdAt,
  popularity,
})

const creations = [
  createCreation('alpha', 'Alpha', 2, 3, 1),
  createCreation('bravo', 'Bravo', 3, 1, 2),
  createCreation('charlie', 'Charlie', 1, 2, 3),
]

const cardNames = () => screen.getAllByRole('link').map((link) => link.getAttribute('aria-label'))

describe('CreatorContent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('writes sort into the URL and reorders the current cards', async () => {
    const user = userEvent.setup()
    const { onUrlUpdate } = renderWithNuqs(
      <CreatorContent
        creations={creations}
        getCreationAction={(creation) => ({ type: 'link', href: `/creation/${creation.id}` })}
      />,
    )

    expect(cardNames()).toEqual(['Bravo', 'Alpha', 'Charlie'])

    await user.click(screen.getByRole('button', { name: 'Sort by Recently updated' }))
    const recentlyUpdatedOption = screen.getByRole('menuitemradio', {
      name: 'Recently updated',
    })
    const mostPopularOption = screen.getByRole('menuitemradio', { name: 'Most popular' })
    expect(recentlyUpdatedOption).toHaveAttribute('aria-checked', 'true')
    expect(mostPopularOption).toHaveAttribute('aria-checked', 'false')

    await user.click(mostPopularOption)
    await waitFor(() => {
      expect(cardNames()).toEqual(['Charlie', 'Bravo', 'Alpha'])
      expect(onUrlUpdate.mock.calls.at(-1)?.[0].searchParams.get('sort_by')).toBe('popularity')
    })

    await user.click(screen.getByRole('button', { name: 'Sort ascending' }))
    await waitFor(() => {
      expect(cardNames()).toEqual(['Alpha', 'Bravo', 'Charlie'])
      expect(onUrlUpdate.mock.calls.at(-1)?.[0].searchParams.get('sort_order')).toBe('asc')
      expect(onUrlUpdate.mock.calls.at(-1)?.[0].searchParams.get('sort_by')).toBe('popularity')
    })
  })

  it('loads the next publisher pages when more creations exist', async () => {
    const user = userEvent.setup()
    publisherMocks.fetchPublisherPluginPage.mockResolvedValue({
      items: [
        {
          type: 'plugin',
          org: 'dify',
          name: 'delta',
          labels: { 'en-US': 'Delta' },
          brief: { 'en-US': 'Delta plugin' },
          install_count: 4,
          created_at: '2026-01-04T00:00:00Z',
          updated_at: '2026-02-04T00:00:00Z',
        },
      ],
      hasMore: false,
    })
    publisherMocks.fetchPublisherTemplatePage.mockResolvedValue({ items: [], hasMore: false })

    renderWithNuqs(
      <CreatorContent
        creations={creations}
        locale="en-US"
        inventory={{
          uniqueHandle: 'scarlettmao',
          pluginHasMore: true,
          templateHasMore: false,
          pluginNextPage: 2,
          templateNextPage: 2,
        }}
        getCreationAction={(creation) => ({ type: 'link', href: `/creation/${creation.id}` })}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Load more' }))

    await waitFor(() => {
      expect(cardNames()).toContain('Delta')
    })
    expect(publisherMocks.fetchPublisherPluginPage).toHaveBeenCalledWith({
      uniqueHandle: 'scarlettmao',
      page: 2,
      sortField: 'updatedAt',
      sortOrder: 'desc',
    })
    expect(publisherMocks.fetchPublisherTemplatePage).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument()
  })
})
