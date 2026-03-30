import type { Tag } from '@/app/components/plugins/hooks'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ToolSelectorTrigger from '../tool-selector'

const tagsMap: Record<string, Tag> = {
  agent: { name: 'agent', label: 'Agent' },
  rag: { name: 'rag', label: 'RAG' },
  search: { name: 'search', label: 'Search' },
}

describe('ToolSelectorTrigger', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render selected tags and overflow count', () => {
    render(
      <ToolSelectorTrigger
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

  it('should clear selected tags and stop propagation when close icon is clicked', () => {
    const onTagsChange = vi.fn()
    const parentClick = vi.fn()
    const { container } = render(
      <div onClick={parentClick}>
        <ToolSelectorTrigger
          selectedTagsLength={1}
          open={false}
          tags={['agent']}
          tagsMap={tagsMap}
          onTagsChange={onTagsChange}
        />
      </div>,
    )

    const icons = container.querySelectorAll('svg')
    fireEvent.click(icons[1] as Element)

    expect(onTagsChange).toHaveBeenCalledWith([])
    expect(parentClick).not.toHaveBeenCalled()
  })

  it('should apply open-state styling when no tag is selected', () => {
    const { container } = render(
      <ToolSelectorTrigger
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
