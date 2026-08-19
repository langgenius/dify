import { fireEvent, render, screen } from '@testing-library/react'
import AddKnowledgeSpace from '../add-knowledge-space'

const mockUseInfiniteQuery = vi.hoisted(() => vi.fn())
const mockInfiniteOptions = vi.hoisted(() => vi.fn((options: unknown) => options))

vi.mock('@tanstack/react-query', () => ({
  useInfiniteQuery: mockUseInfiniteQuery,
}))

vi.mock('ahooks', () => ({
  useInfiniteScroll: vi.fn(),
}))

vi.mock('@/service/client', () => ({
  consoleQuery: {
    knowledgeFs: {
      spaces: {
        get: { infiniteOptions: mockInfiniteOptions },
      },
    },
  },
}))

describe('AddKnowledgeSpace', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseInfiniteQuery.mockReturnValue({
      data: {
        pages: [
          {
            data: [
              {
                control_space_id: 'space-1',
                technical_status: 'available',
                technical_summary: { icon: '📘', name: 'Product docs' },
              },
              {
                control_space_id: 'space-2',
                technical_status: 'unavailable',
                technical_summary: { name: 'Archived docs' },
              },
            ],
            has_more: false,
            page: 1,
          },
        ],
      },
      fetchNextPage: vi.fn(),
      hasNextPage: false,
      isFetchingNextPage: false,
      isLoading: false,
    })
  })

  it('uses a confirmable multi-select dialog and keeps unavailable existing selections removable', () => {
    const onChange = vi.fn()
    render(
      <AddKnowledgeSpace
        selectedSpaces={[{ control_space_id: 'space-2', name: 'Archived docs' }]}
        onChange={onChange}
      />,
    )

    fireEvent.click(
      screen.getByRole('button', {
        name: 'common.operation.add workflow.nodes.knowledgeRetrievalV2.knowledgeSpaces',
      }),
    )
    expect(screen.getByRole('button', { name: /Archived docs/ })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: /Archived docs/ }))
    fireEvent.click(screen.getByRole('button', { name: /Product docs/ }))
    fireEvent.click(screen.getByRole('button', { name: 'common.operation.add' }))

    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ control_space_id: 'space-1', icon: '📘', name: 'Product docs' }),
    ])
  })
})
