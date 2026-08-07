import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import Icon from '../card-icon'

describe('Plugin card icon', () => {
  it('lazy-loads URL icons and hides a failed image', () => {
    render(<Icon src="https://example.com/plugin-icon.png" />)

    const image = screen.getByAltText('')

    expect(image).toHaveAttribute('src', 'https://example.com/plugin-icon.png')
    expect(image).toHaveAttribute('loading', 'lazy')
    expect(image).toHaveAttribute('decoding', 'async')
    expect(image).toHaveAttribute('width', '40')
    expect(image).toHaveAttribute('height', '40')

    fireEvent.error(image)

    expect(image).toHaveStyle({ display: 'none' })
  })
})
