import type { Tag } from '../../../../hooks'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import ToolSelectorTrigger from '../tool-selector'

const tagsMap: Record<string, Tag> = {
  agent: { name: 'agent', label: 'Agent' },
  rag: { name: 'rag', label: 'RAG' },
  search: { name: 'search', label: 'Search' },
}

describe('ToolSelectorTrigger', () => {
  it('renders only icon when no tags are selected', () => {
    const { container } = render(
      <ToolSelectorTrigger
        selectedTagsLength={0}
        open={false}
        tags={[]}
        tagsMap={tagsMap}
        onTagsChange={vi.fn()}
      />,
    )

    expect(container.querySelectorAll('svg')).toHaveLength(1)
    expect(screen.queryByText('Agent')).not.toBeInTheDocument()
  })

  it('renders selected tag labels and overflow count', () => {
    const { container } = render(
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
    expect(container.querySelectorAll('svg')).toHaveLength(2)
  })

  it('clears selected tags when clear icon is clicked', () => {
    const onTagsChange = vi.fn()

    const { container } = render(
      <ToolSelectorTrigger
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
