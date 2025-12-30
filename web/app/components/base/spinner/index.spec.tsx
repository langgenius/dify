import { render } from '@testing-library/react'
import * as React from 'react'
import Spinner from './index'

describe('Spinner component', () => {
  it('should render correctly when loading is true', () => {
    const { container } = render(<Spinner loading={true} />)
    const spinner = container.firstChild as HTMLElement

    expect(spinner).toHaveClass('animate-spin')

    // Check for accessibility text
    const screenReaderText = spinner.querySelector('span')
    expect(screenReaderText).toBeInTheDocument()
    expect(screenReaderText).toHaveTextContent('Loading...')
  })

  it('should be hidden when loading is false', () => {
    const { container } = render(<Spinner loading={false} />)
    const spinner = container.firstChild as HTMLElement

    expect(spinner).toHaveClass('hidden')
  })

  it('should render with custom className', () => {
    const customClass = 'text-blue-500'
    const { container } = render(<Spinner loading={true} className={customClass} />)
    const spinner = container.firstChild as HTMLElement

    expect(spinner).toHaveClass(customClass)
  })

  it('should render children correctly', () => {
    const childText = 'Child content'
    const { getByText } = render(
      <Spinner loading={true}>{childText}</Spinner>,
    )

    expect(getByText(childText)).toBeInTheDocument()
  })

  it('should use default loading value (false) when not provided', () => {
    const { container } = render(<Spinner />)
    const spinner = container.firstChild as HTMLElement

    expect(spinner).toHaveClass('hidden')
  })
})
