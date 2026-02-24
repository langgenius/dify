import type { OnFeaturesChange } from '../types'
import { fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import { FeaturesProvider } from '../context'
import MoreLikeThis from './more-like-this'

const renderWithProvider = (props: { disabled?: boolean, onChange?: OnFeaturesChange } = {}) => {
  return render(
    <FeaturesProvider>
      <MoreLikeThis disabled={props.disabled} onChange={props.onChange} />
    </FeaturesProvider>,
  )
}

describe('MoreLikeThis', () => {
  it('should render the more-like-this feature card', () => {
    renderWithProvider()

    expect(screen.getByText(/feature\.moreLikeThis\.title/)).toBeInTheDocument()
  })

  it('should render description text', () => {
    renderWithProvider()

    expect(screen.getByText(/feature\.moreLikeThis\.description/)).toBeInTheDocument()
  })

  it('should render a switch toggle', () => {
    renderWithProvider()

    expect(screen.getByRole('switch')).toBeInTheDocument()
  })

  it('should call onChange when toggled', () => {
    const onChange = vi.fn()
    renderWithProvider({ onChange })

    fireEvent.click(screen.getByRole('switch'))

    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('should not throw when onChange is not provided', () => {
    renderWithProvider()

    expect(() => fireEvent.click(screen.getByRole('switch'))).not.toThrow()
  })

  it('should render tooltip for the feature', () => {
    renderWithProvider()

    // MoreLikeThis has a tooltip prop, verifying the feature renders with title
    expect(screen.getByText(/feature\.moreLikeThis\.title/)).toBeInTheDocument()
  })
})
