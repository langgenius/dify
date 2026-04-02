import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TagFilter from '../tag-filter'

vi.mock('../../../hooks', () => ({
  useTags: () => ({
    tags: [
      { name: 'agent', label: 'Agent' },
      { name: 'rag', label: 'RAG' },
      { name: 'search', label: 'Search' },
    ],
    getTagLabel: (name: string) => ({
      agent: 'Agent',
      rag: 'RAG',
      search: 'Search',
    }[name] ?? name),
  }),
}))

vi.mock('@langgenius/dify-ui/popover', () => import('@/__mocks__/base-ui-popover'))

describe('TagFilter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the all tags placeholder when nothing is selected', () => {
    render(<TagFilter value={[]} onChange={vi.fn()} />)

    expect(screen.getByText('pluginTags.allTags')).toBeInTheDocument()
  })

  it('renders selected tag labels and the overflow counter', () => {
    render(<TagFilter value={['agent', 'rag', 'search']} onChange={vi.fn()} />)

    expect(screen.getByText('Agent,RAG')).toBeInTheDocument()
    expect(screen.getByText('+1')).toBeInTheDocument()
  })

  it('filters options by search text and toggles tag selection', () => {
    const onChange = vi.fn()
    render(<TagFilter value={['agent']} onChange={onChange} />)

    fireEvent.click(screen.getByTestId('popover-trigger'))
    const portal = screen.getByTestId('popover-content')

    fireEvent.change(screen.getByPlaceholderText('pluginTags.searchTags'), { target: { value: 'ra' } })

    expect(within(portal).queryByText('Agent')).not.toBeInTheDocument()
    expect(within(portal).getByText('RAG')).toBeInTheDocument()

    fireEvent.click(within(portal).getByText('RAG'))

    expect(onChange).toHaveBeenCalledWith(['agent', 'rag'])
  })

  it('clears all selected tags when the clear icon is clicked', () => {
    const onChange = vi.fn()
    render(<TagFilter value={['agent']} onChange={onChange} />)

    const trigger = screen.getByTestId('popover-trigger')
    fireEvent.click(trigger.querySelector('svg')!)

    expect(onChange).toHaveBeenCalledWith([])
  })

  it('removes a selected tag when clicking the same option again', () => {
    const onChange = vi.fn()
    render(<TagFilter value={['agent']} onChange={onChange} />)

    fireEvent.click(screen.getByTestId('popover-trigger'))
    fireEvent.click(within(screen.getByTestId('popover-content')).getByText('Agent'))

    expect(onChange).toHaveBeenCalledWith([])
  })
})
