import type { RefObject } from 'react'
import { render, screen } from '@testing-library/react'
import QueryBlockComponent from './component'
import { DELETE_QUERY_BLOCK_COMMAND } from './index'

const { mockUseSelectOrDelete } = vi.hoisted(() => ({
  mockUseSelectOrDelete: vi.fn(),
}))

vi.mock('../../hooks', () => ({
  useSelectOrDelete: (...args: unknown[]) => mockUseSelectOrDelete(...args),
}))

describe('QueryBlockComponent', () => {
  const createHookReturn = (isSelected: boolean): [RefObject<HTMLDivElement | null>, boolean] => {
    return [{ current: null }, isSelected]
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render query title and register select or delete hook with node key', () => {
      mockUseSelectOrDelete.mockReturnValue(createHookReturn(false))

      render(<QueryBlockComponent nodeKey="query-node-1" />)

      expect(mockUseSelectOrDelete).toHaveBeenCalledWith('query-node-1', DELETE_QUERY_BLOCK_COMMAND)
      expect(screen.getByText('common.promptEditor.query.item.title')).toBeInTheDocument()
    })

    it('should apply selected border class when the block is selected', () => {
      mockUseSelectOrDelete.mockReturnValue(createHookReturn(true))

      const { container } = render(<QueryBlockComponent nodeKey="query-node-2" />)
      const wrapper = container.firstElementChild

      expect(wrapper).toHaveClass('!border-[#FD853A]')
    })

    it('should not apply selected border class when the block is not selected', () => {
      mockUseSelectOrDelete.mockReturnValue(createHookReturn(false))

      const { container } = render(<QueryBlockComponent nodeKey="query-node-3" />)
      const wrapper = container.firstElementChild

      expect(wrapper).not.toHaveClass('!border-[#FD853A]')
    })
  })
})
