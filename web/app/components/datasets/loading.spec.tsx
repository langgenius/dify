import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import DatasetsLoading from './loading'

afterEach(() => {
  cleanup()
})

describe('DatasetsLoading', () => {
  it('should render null', () => {
    const { container } = render(<DatasetsLoading />)
    expect(container.firstChild).toBeNull()
  })

  it('should not throw on multiple renders', () => {
    expect(() => {
      render(<DatasetsLoading />)
      render(<DatasetsLoading />)
    }).not.toThrow()
  })
})
