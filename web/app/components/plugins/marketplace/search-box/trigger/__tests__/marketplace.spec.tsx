import type { Tag } from '../../../../hooks'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import MarketplaceTrigger from '../marketplace'

vi.mock('#i18n', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { ns?: string }) => options?.ns ? `${options.ns}.${key}` : key,
  }),
}))

vi.mock('@remixicon/react', () => ({
  RiArrowDownSLine: () => <span data-testid="arrow-icon">arrow</span>,
  RiCloseCircleFill: ({ onClick }: { onClick?: () => void }) => <button data-testid="clear-icon" onClick={onClick}>clear</button>,
  RiFilter3Line: () => <span data-testid="filter-icon">filter</span>,
}))

const tagsMap: Record<string, Tag> = {
  agent: { name: 'agent', label: 'Agent' },
  rag: { name: 'rag', label: 'RAG' },
  search: { name: 'search', label: 'Search' },
}

describe('MarketplaceTrigger', () => {
  it('shows all-tags text when no tags are selected', () => {
    render(
      <MarketplaceTrigger
        selectedTagsLength={0}
        open={false}
        tags={[]}
        tagsMap={tagsMap}
        onTagsChange={vi.fn()}
      />,
    )

    expect(screen.getByText('pluginTags.allTags')).toBeInTheDocument()
    expect(screen.getByTestId('arrow-icon')).toBeInTheDocument()
    expect(screen.queryByTestId('clear-icon')).not.toBeInTheDocument()
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

    render(
      <MarketplaceTrigger
        selectedTagsLength={1}
        open={false}
        tags={['agent']}
        tagsMap={tagsMap}
        onTagsChange={onTagsChange}
      />,
    )

    fireEvent.click(screen.getByTestId('clear-icon'))

    expect(onTagsChange).toHaveBeenCalledWith([])
  })
})
