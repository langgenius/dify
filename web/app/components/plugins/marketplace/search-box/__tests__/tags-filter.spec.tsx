import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TagsFilter from '../tags-filter'

const { mockTranslate } = vi.hoisted(() => ({
  mockTranslate: vi.fn((key: string, options?: { ns?: string }) => options?.ns ? `${options.ns}.${key}` : key),
}))

vi.mock('#i18n', () => ({
  useTranslation: () => ({
    t: mockTranslate,
  }),
}))

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

vi.mock('@/app/components/base/checkbox', () => ({
  default: ({ checked }: { checked: boolean }) => <span data-testid="checkbox">{String(checked)}</span>,
}))

vi.mock('@/app/components/base/input', () => ({
  default: ({
    value,
    onChange,
    placeholder,
  }: {
    value: string
    onChange: (event: { target: { value: string } }) => void
    placeholder: string
  }) => (
    <input
      aria-label="tags-search"
      value={value}
      placeholder={placeholder}
      onChange={event => onChange({ target: { value: event.target.value } })}
    />
  ),
}))

vi.mock('@langgenius/dify-ui/popover', () => import('@/__mocks__/base-ui-popover'))

vi.mock('../trigger/marketplace', () => ({
  default: ({ selectedTagsLength }: { selectedTagsLength: number }) => (
    <div data-testid="marketplace-trigger">
      marketplace:
      {selectedTagsLength}
    </div>
  ),
}))

vi.mock('../trigger/tool-selector', () => ({
  default: ({ selectedTagsLength }: { selectedTagsLength: number }) => (
    <div data-testid="tool-trigger">
      tool:
      {selectedTagsLength}
    </div>
  ),
}))

describe('TagsFilter', () => {
  const ensurePopoverOpen = () => {
    if (!screen.queryByTestId('popover-content'))
      fireEvent.click(screen.getByTestId('popover-trigger'))

    return screen.getByTestId('popover-content')
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockTranslate.mockImplementation((key: string, options?: { ns?: string }) => options?.ns ? `${options.ns}.${key}` : key)
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
    fireEvent.click(screen.getByTestId('popover-trigger'))

    expect(screen.getByText('Agent')).toBeInTheDocument()
    expect(screen.getByText('RAG')).toBeInTheDocument()
    expect(screen.getByText('Search')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('tags-search'), { target: { value: 'ra' } })

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
    fireEvent.click(screen.getByTestId('popover-trigger'))

    expect(screen.getByLabelText('tags-search')).toHaveAttribute('placeholder', '')
  })
})
