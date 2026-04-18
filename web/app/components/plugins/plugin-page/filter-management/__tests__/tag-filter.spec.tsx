import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TagFilter from '../tag-filter'

let portalOpen = false

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

vi.mock('@/app/components/base/portal-to-follow-elem', () => ({
  PortalToFollowElem: ({
    children,
    open,
  }: {
    children: React.ReactNode
    open: boolean
  }) => {
    portalOpen = open
    return <div>{children}</div>
  },
  PortalToFollowElemTrigger: ({
    children,
    onClick,
  }: {
    children: React.ReactNode
    onClick: () => void
  }) => <button data-testid="trigger" onClick={onClick}>{children}</button>,
  PortalToFollowElemContent: ({
    children,
  }: {
    children: React.ReactNode
  }) => portalOpen ? <div data-testid="portal-content">{children}</div> : null,
}))

describe('TagFilter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    portalOpen = false
  })

  it('renders selected tag labels and the overflow counter', () => {
    render(<TagFilter value={['agent', 'rag', 'search']} onChange={vi.fn()} />)

    expect(screen.getByText('Agent,RAG')).toBeInTheDocument()
    expect(screen.getByText('+1')).toBeInTheDocument()
  })

  it('filters options by search text and toggles tag selection', () => {
    const onChange = vi.fn()
    render(<TagFilter value={['agent']} onChange={onChange} />)

    fireEvent.click(screen.getByTestId('trigger'))
    const portal = screen.getByTestId('portal-content')

    fireEvent.change(screen.getByPlaceholderText('pluginTags.searchTags'), { target: { value: 'ra' } })

    expect(within(portal).queryByText('Agent')).not.toBeInTheDocument()
    expect(within(portal).getByText('RAG')).toBeInTheDocument()

    fireEvent.click(within(portal).getByText('RAG'))

    expect(onChange).toHaveBeenCalledWith(['agent', 'rag'])
  })
})
