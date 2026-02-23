import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import DatasetPreview from '../index'

afterEach(() => {
  cleanup()
})

describe('DatasetPreview', () => {
  it('should render null', () => {
    const { container } = render(<DatasetPreview />)
    expect(container.firstChild).toBeNull()
  })

  it('should be a valid function component', () => {
    expect(typeof DatasetPreview).toBe('function')
  })

  it('should not throw on multiple renders', () => {
    expect(() => {
      render(<DatasetPreview />)
      render(<DatasetPreview />)
    }).not.toThrow()
  })
})
