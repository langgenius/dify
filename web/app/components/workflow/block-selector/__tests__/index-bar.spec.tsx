import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IndexBar } from '../index-bar'

describe('IndexBar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Clicking a letter should scroll the matching section into view.
  describe('Rendering', () => {
    it('should let keyboard users scroll to the selected letter', async () => {
      const user = userEvent.setup()
      const scrollIntoView = vi.fn()
      const itemRefs = {
        current: {
          A: { scrollIntoView } as unknown as HTMLElement,
        },
      }

      render(<IndexBar letters={['A']} itemRefs={itemRefs} />)

      await user.tab()
      expect(screen.getByRole('button', { name: 'A' })).toHaveFocus()
      await user.keyboard('{Enter}')

      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth' })
    })
  })
})
