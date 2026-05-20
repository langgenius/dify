import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Tooltip from '../tooltip'

describe('Tooltip', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Rendering the info tooltip container
  describe('Rendering', () => {
    it('should render the content panel when hovered', async () => {
      const user = userEvent.setup()
      const content = 'Usage resets on the first day of every month.'

      render(<Tooltip content={content} />)
      await user.hover(screen.getByRole('button', { name: content }))

      expect(await screen.findByText(content)).toBeInTheDocument()
    })
  })

  describe('Icon rendering', () => {
    it('should render the icon when provided with content', () => {
      const content = 'Tooltips explain each plan detail.'

      render(<Tooltip content={content} />)

      expect(screen.getByTestId('tooltip-icon')).toBeInTheDocument()
    })
  })

  // Handling empty strings while keeping structure consistent
  describe('Edge cases', () => {
    it('should render without crashing when passed empty content', () => {
      const content = ''

      // Act and Assert
      expect(() => render(<Tooltip content={content} />)).not.toThrow()
    })
  })
})
