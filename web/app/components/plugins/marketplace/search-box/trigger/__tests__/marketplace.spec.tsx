import type { Tag } from '@/app/components/plugins/hooks'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import MarketplaceTrigger from '../marketplace'

vi.mock('#i18n', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

const tagsMap: Record<string, Tag> = {
  agent: { name: 'agent', label: 'Agent' },
  rag: { name: 'rag', label: 'RAG' },
  search: { name: 'search', label: 'Search' },
}

describe('MarketplaceTrigger', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render all-tags label when no tag is selected', () => {
    render(
      <MarketplaceTrigger
        selectedTagsLength={0}
        open={false}
        tags={[]}
        tagsMap={tagsMap}
        onTagsChange={vi.fn()}
      />,
    )

    expect(screen.getByText('allTags')).toBeInTheDocument()
  })

  it('should render selected tag labels and overflow count', () => {
    render(
      <MarketplaceTrigger
        selectedTagsLength={3}
        open={false}
        tags={['agent', 'rag', 'search']}
        tagsMap={tagsMap}
        onTagsChange={vi.fn()}
      />,
    )

    expect(screen.getByText('Agent,RAG')).toBeInTheDocument()
    expect(screen.getByText('+1')).toBeInTheDocument()
  })

  it('should clear selected tags when close icon is clicked', () => {
    const onTagsChange = vi.fn()
    const { container } = render(
      <MarketplaceTrigger
        selectedTagsLength={2}
        open={false}
        tags={['agent', 'rag']}
        tagsMap={tagsMap}
        onTagsChange={onTagsChange}
      />,
    )

    const icons = container.querySelectorAll('svg')
    fireEvent.click(icons[1] as Element)

    expect(onTagsChange).toHaveBeenCalledWith([])
  })

  it('should apply open-state styling without selected tags', () => {
    const { container } = render(
      <MarketplaceTrigger
        selectedTagsLength={0}
        open
        tags={[]}
        tagsMap={tagsMap}
        onTagsChange={vi.fn()}
      />,
    )

    expect(container.firstChild).toHaveClass('bg-state-base-hover')
  })
})
