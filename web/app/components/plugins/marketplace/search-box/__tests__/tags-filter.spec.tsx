import { fireEvent, render, screen, within } from '@testing-library/react'
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

vi.mock('../trigger/marketplace', async () => {
  const { PopoverTrigger } = await import('@langgenius/dify-ui/popover')

  return {
    default: ({ selectedTagsLength }: { selectedTagsLength: number }) => (
      <PopoverTrigger
        render={
          <button type="button" data-testid="marketplace-trigger">
            marketplace:
            {selectedTagsLength}
          </button>
        }
      />
    ),
  }
})

vi.mock('../trigger/tool-selector', async () => {
  const { PopoverTrigger } = await import('@langgenius/dify-ui/popover')

  return {
    default: ({ selectedTagsLength }: { selectedTagsLength: number }) => (
      <PopoverTrigger
        render={
          <button type="button" data-testid="tool-trigger">
            tool:
            {selectedTagsLength}
          </button>
        }
      />
    ),
  }
})

describe('TagsFilter', () => {
  const ensurePopoverOpen = () => {
    if (!screen.queryByTestId('popover-content'))
      fireEvent.click(screen.getByTestId('tool-trigger'))

    return screen.getByTestId('popover-content')
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockTranslate.mockImplementation((key: string, options?: { ns?: string }) =>
      options?.ns ? `${options.ns}.${key}` : key,
    )
  })

  it('renders marketplace trigger when used in marketplace', () => {
    render(<TagsFilter tags={['agent']} onTagsChange={vi.fn()} usedInMarketplace />)

    expect(screen.getByTestId('marketplace-trigger')).toHaveTextContent('marketplace:1')
    expect(screen.queryByTestId('tool-trigger')).not.toBeInTheDocument()
  })

  it('renders tool selector trigger when used outside marketplace', () => {
    render(<TagsFilter tags={['agent']} onTagsChange={vi.fn()} />)

    expect(screen.getByTestId('tool-trigger')).toHaveTextContent('tool:1')
    expect(screen.queryByTestId('marketplace-trigger')).not.toBeInTheDocument()
  })

  it('filters tag options by search text', () => {
    render(<TagsFilter tags={[]} onTagsChange={vi.fn()} />)
    fireEvent.click(screen.getByTestId('tool-trigger'))

    expect(screen.getByText('Agent')).toBeInTheDocument()
    expect(screen.getByText('RAG')).toBeInTheDocument()
    expect(screen.getByText('Search')).toBeInTheDocument()

    fireEvent.change(screen.getByRole('searchbox', { name: 'pluginTags.searchTags' }), {
      target: { value: 'ra' },
    })

    expect(screen.queryByText('Agent')).not.toBeInTheDocument()
    expect(screen.getByText('RAG')).toBeInTheDocument()
    expect(screen.queryByText('Search')).not.toBeInTheDocument()
  })

  it('adds and removes selected tags when options are clicked', () => {
    const onTagsChange = vi.fn()
    const { rerender } = render(<TagsFilter tags={['agent']} onTagsChange={onTagsChange} />)

    fireEvent.click(within(ensurePopoverOpen()).getByText('Agent'))
    expect(onTagsChange).toHaveBeenCalledWith([])

    rerender(<TagsFilter tags={['agent']} onTagsChange={onTagsChange} />)
    fireEvent.click(within(ensurePopoverOpen()).getByText('RAG'))
    expect(onTagsChange).toHaveBeenCalledWith(['agent', 'rag'])
  })

  it('falls back to an empty placeholder when translation is missing', () => {
    mockTranslate.mockImplementation(() => undefined as unknown as string)

    render(<TagsFilter tags={[]} onTagsChange={vi.fn()} />)
    fireEvent.click(screen.getByTestId('tool-trigger'))

    expect(screen.getByRole('searchbox')).toHaveAttribute('placeholder', '')
  })
})
