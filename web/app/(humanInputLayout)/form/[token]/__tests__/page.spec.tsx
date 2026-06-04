import { render, screen } from '@testing-library/react'
import FormPage from '../page'

vi.mock('../form', () => ({
  __esModule: true,
  default: () => <div>form-content</div>,
}))

describe('Human input share form page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render the form content inside the page shell', () => {
    render(<FormPage />)

    expect(screen.getByText('form-content')).toBeInTheDocument()
  })
})
