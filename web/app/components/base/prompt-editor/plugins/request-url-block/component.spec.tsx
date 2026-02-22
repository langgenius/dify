import type { RefObject } from 'react'
import { render, screen } from '@testing-library/react'
import RequestURLBlockComponent from './component'
import { DELETE_REQUEST_URL_BLOCK_COMMAND } from './index'

const { mockUseSelectOrDelete } = vi.hoisted(() => ({
  mockUseSelectOrDelete: vi.fn(),
}))

vi.mock('../../hooks', () => ({
  useSelectOrDelete: (...args: unknown[]) => mockUseSelectOrDelete(...args),
}))

describe('RequestURLBlockComponent', () => {
  const createHookReturn = (isSelected: boolean): [RefObject<HTMLDivElement | null>, boolean] => {
    return [{ current: null }, isSelected]
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render request URL title and register select or delete hook with node key', () => {
      mockUseSelectOrDelete.mockReturnValue(createHookReturn(false))

      render(<RequestURLBlockComponent nodeKey="node-1" />)

      expect(mockUseSelectOrDelete).toHaveBeenCalledWith('node-1', DELETE_REQUEST_URL_BLOCK_COMMAND)
      expect(screen.getByText('common.promptEditor.requestURL.item.title')).toBeInTheDocument()
    })

    it('should apply selected border classes when the block is selected', () => {
      mockUseSelectOrDelete.mockReturnValue(createHookReturn(true))

      const { container } = render(<RequestURLBlockComponent nodeKey="node-2" />)
      const wrapper = container.firstElementChild

      expect(wrapper).toHaveClass('!border-[#7839ee]')
      expect(wrapper).toHaveClass('hover:!border-[#7839ee]')
    })

    it('should not apply selected border classes when the block is not selected', () => {
      mockUseSelectOrDelete.mockReturnValue(createHookReturn(false))

      const { container } = render(<RequestURLBlockComponent nodeKey="node-3" />)
      const wrapper = container.firstElementChild

      expect(wrapper).not.toHaveClass('!border-[#7839ee]')
      expect(wrapper).not.toHaveClass('hover:!border-[#7839ee]')
    })
  })
})
