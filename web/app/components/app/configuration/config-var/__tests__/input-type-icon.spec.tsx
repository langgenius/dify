import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import InputTypeIcon from '../input-type-icon'

describe('InputTypeIcon', () => {
  it('should render icons for supported variable types', () => {
    const { container, rerender } = render(<InputTypeIcon className="text-test" type="string" />)
    expect(container.querySelector('svg')).toBeTruthy()

    rerender(<InputTypeIcon className="text-test" type="select" />)
    expect(container.querySelector('svg')).toBeTruthy()
  })
})
