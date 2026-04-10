import { render, screen } from '@testing-library/react'
import ResPlaceholder from '../res-placeholder'

describe('ResPlaceholder', () => {
  it('should render the placeholder copy', () => {
    render(<ResPlaceholder />)

    expect(screen.getByText('appDebug.generate.newNoDataLine1')).toBeInTheDocument()
  })
})
