import type { OnFeaturesChange } from '../types'
import { fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import { FeaturesProvider } from '../context'
import FollowUp from './follow-up'

const renderWithProvider = (props: { disabled?: boolean, onChange?: OnFeaturesChange } = {}) => {
  return render(
    <FeaturesProvider>
      <FollowUp disabled={props.disabled} onChange={props.onChange} />
    </FeaturesProvider>,
  )
}

describe('FollowUp', () => {
  it('should render the follow-up feature card', () => {
    renderWithProvider()

    expect(screen.getByText(/feature\.suggestedQuestionsAfterAnswer\.title/)).toBeInTheDocument()
  })

  it('should render description text', () => {
    renderWithProvider()

    expect(screen.getByText(/feature\.suggestedQuestionsAfterAnswer\.description/)).toBeInTheDocument()
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
})
