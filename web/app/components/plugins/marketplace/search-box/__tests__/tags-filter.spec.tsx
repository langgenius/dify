import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TagsFilter from '../tags-filter'

const { mockTranslate } = vi.hoisted(() => ({
  mockTranslate: vi.fn((key: string, options?: { ns?: string }) =>
    options?.ns ? `${options.ns}.${key}` : key,
  ),
}))

vi.mock('#i18n', async () => {
  const { withSelectorKey } = await import('@/test/i18n-mock')
  return {
    useTranslation: () => ({
      t: withSelectorKey(mockTranslate),
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

vi.mock('@langgenius/dify-ui/popover', () => import('@/__mocks__/base-ui-popover'))

describe('TagsFilter', () => {
  const ensurePopoverOpen = async (user: ReturnType<typeof userEvent.setup>) => {
    if (!screen.queryByRole('searchbox', { name: 'pluginTags.searchTags' }))
      await user.click(screen.getByRole('button', { name: 'pluginTags.allTags' }))

    return screen.getByRole('searchbox', { name: 'pluginTags.searchTags' })
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockTranslate.mockImplementation((key: string, options?: { ns?: string }) =>
      options?.ns ? `${options.ns}.${key}` : key,
    )
  })

  it('filters tag options by search text', async () => {
    const user = userEvent.setup()
    render(<TagsFilter tags={[]} onTagsChange={vi.fn()} />)
    const search = await ensurePopoverOpen(user)

    expect(screen.getByRole('checkbox', { name: 'Agent' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'RAG' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Search' })).toBeInTheDocument()

    await user.type(search, 'ra')

    expect(screen.queryByRole('checkbox', { name: 'Agent' })).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'RAG' })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'Search' })).not.toBeInTheDocument()
  })

  it('adds and removes selected tags when options are clicked', async () => {
    const user = userEvent.setup()
    const onTagsChange = vi.fn()
    const { rerender } = render(<TagsFilter tags={['agent']} onTagsChange={onTagsChange} />)

    await user.click(screen.getByRole('button', { name: 'Agent' }))
    await user.click(screen.getByRole('checkbox', { name: 'Agent' }))
    expect(onTagsChange).toHaveBeenCalledWith([])

    rerender(<TagsFilter tags={['agent']} onTagsChange={onTagsChange} />)
    await user.click(screen.getByRole('checkbox', { name: 'RAG' }))
    expect(onTagsChange).toHaveBeenCalledWith(['agent', 'rag'])
  })

  it('falls back to an empty placeholder when translation is missing', async () => {
    const user = userEvent.setup()
    mockTranslate.mockImplementation(() => undefined as unknown as string)

    render(<TagsFilter tags={[]} onTagsChange={vi.fn()} />)
    await user.click(screen.getByRole('button'))

    expect(screen.getByRole('searchbox')).toHaveAttribute('placeholder', '')
  })
})
