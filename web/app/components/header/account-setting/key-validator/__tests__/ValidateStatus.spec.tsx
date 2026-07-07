import { render, screen } from '@testing-library/react'
import {
  ValidatingTip,
} from '../ValidateStatus'

describe('ValidateStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should show validating text while validation is running', () => {
    render(<ValidatingTip />)

    expect(screen.getByText('common.provider.validating')).toBeInTheDocument()
  })
})
