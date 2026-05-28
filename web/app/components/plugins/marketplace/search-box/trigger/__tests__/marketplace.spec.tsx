import type { Tag } from '../../../../hooks'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import MarketplaceTrigger from '../marketplace'

vi.mock('#i18n', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { ns?: string }) => options?.ns ? `${options.ns}.${key}` : key,
  }),
}))

const tagsMap: Record<string, Tag> = {
  agent: { name: 'agent', label: 'Agent' },
  rag: { name: 'rag', label: 'RAG' },
  search: { name: 'search', label: 'Search' },
}

describe('MarketplaceTrigger', () => {
  it('shows all-tags text when no tags are selected', () => {
    const { container } = render(
      <MarketplaceTrigger
        selectedTagsLength={0}
        open={false}
        tags={[]}
        tagsMap={tagsMap}
        onTagsChange={vi.fn()}
      />,
    )

    expect(screen.getByText('pluginTags.allTags')).toBeInTheDocument()
    expect(container.querySelectorAll('svg').length).toBeGreaterThan(0)
    expect(container.querySelectorAll('svg').length).toBe(2)
  })

  it('shows selected tag labels and overflow count', () => {
    render(
      <MarketplaceTrigger
        selectedTagsLength={3}
        open
        tags={['agent', 'rag', 'search']}
        tagsMap={tagsMap}
        onTagsChange={vi.fn()}
      />,
    )

    expect(screen.getByText('Agent,RAG')).toBeInTheDocument()
    expect(screen.getByText('+1')).toBeInTheDocument()
  })

  it('clears selected tags when clear icon is clicked', () => {
    const onTagsChange = vi.fn()

    const { container } = render(
      <MarketplaceTrigger
        selectedTagsLength={1}
        open={false}
        tags={['agent']}
        tagsMap={tagsMap}
        onTagsChange={onTagsChange}
      />,
    )

    fireEvent.click(container.querySelectorAll('svg')[1]!)

    expect(onTagsChange).toHaveBeenCalledWith([])
  })
})
