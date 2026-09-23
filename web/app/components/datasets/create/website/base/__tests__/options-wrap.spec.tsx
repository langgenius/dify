import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vite-plus/test'
import OptionsWrap from '../options-wrap'

describe('OptionsWrap', () => {
  it('should render children when not folded', () => {
    render(
      <OptionsWrap>
        <div data-testid="child-content">Options here</div>
      </OptionsWrap>,
    )
    expect(screen.getByTestId('child-content')).toBeInTheDocument()
  })

  it('should toggle fold on click', () => {
    render(
      <OptionsWrap>
        <div data-testid="child-content">Options here</div>
      </OptionsWrap>,
    )
    // Initially visible
    expect(screen.getByTestId('child-content')).toBeInTheDocument()

    fireEvent.click(screen.getByText('datasetCreation.stepOne.website.options'))
    expect(screen.queryByTestId('child-content')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('datasetCreation.stepOne.website.options'))
    expect(screen.getByTestId('child-content')).toBeInTheDocument()
  })

  it('should render options label', () => {
    render(
      <OptionsWrap>
        <div>Content</div>
      </OptionsWrap>,
    )
    expect(screen.getByText('datasetCreation.stepOne.website.options')).toBeInTheDocument()
  })
})
