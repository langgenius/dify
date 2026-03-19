import { render, screen } from '@testing-library/react'
import InputField from '../index'

describe('InputField', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // The placeholder field should render its title, body, and add action.
  describe('Rendering', () => {
    it('should render the default field title and content', () => {
      render(<InputField />)

      expect(screen.getAllByText('input field')).toHaveLength(2)
      expect(screen.getByRole('button')).toBeInTheDocument()
    })
  })
})
