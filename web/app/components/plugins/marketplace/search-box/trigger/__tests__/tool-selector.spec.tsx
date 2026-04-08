import type { Tag } from '../../../../hooks'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import ToolSelectorTrigger from '../tool-selector'

vi.mock('@remixicon/react', () => ({
  RiCloseCircleFill: ({ onClick }: { onClick?: (event: { stopPropagation: () => void }) => void }) => (
    <button
      data-testid="clear-icon"
      onClick={() => onClick?.({ stopPropagation: vi.fn() })}
    >
      clear
    </button>
  ),
  RiPriceTag3Line: () => <span data-testid="tag-icon">tag</span>,
}))

const tagsMap: Record<string, Tag> = {
  agent: { name: 'agent', label: 'Agent' },
  rag: { name: 'rag', label: 'RAG' },
  search: { name: 'search', label: 'Search' },
}

describe('ToolSelectorTrigger', () => {
  it('renders only icon when no tags are selected', () => {
    render(
      <ToolSelectorTrigger
        selectedTagsLength={0}
        open={false}
        tags={[]}
        tagsMap={tagsMap}
        onTagsChange={vi.fn()}
      />,
    )

    expect(screen.getByTestId('tag-icon')).toBeInTheDocument()
    expect(screen.queryByTestId('clear-icon')).not.toBeInTheDocument()
    expect(screen.queryByText('Agent')).not.toBeInTheDocument()
  })

  it('renders selected tag labels and overflow count', () => {
    render(
      <ToolSelectorTrigger
        selectedTagsLength={3}
        open
        tags={['agent', 'rag', 'search']}
        tagsMap={tagsMap}
        onTagsChange={vi.fn()}
      />,
    )

    expect(screen.getByText('Agent,RAG')).toBeInTheDocument()
    expect(screen.getByText('+1')).toBeInTheDocument()
    expect(screen.getByTestId('clear-icon')).toBeInTheDocument()
  })

  it('clears selected tags when clear icon is clicked', () => {
    const onTagsChange = vi.fn()

    render(
      <ToolSelectorTrigger
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
