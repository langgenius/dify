import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import NoData from './index'

describe('NoData', () => {
  it('renders title/description and calls callback when button clicked', () => {
    const handleStart = vi.fn()
    render(<NoData onStartCreateContent={handleStart} />)

    const title = screen.getByText('share.generation.savedNoData.title')
    const description = screen.getByText('share.generation.savedNoData.description')
    const button = screen.getByRole('button', { name: 'share.generation.savedNoData.startCreateContent' })

    expect(title).toBeInTheDocument()
    expect(description).toBeInTheDocument()
    expect(button).toBeInTheDocument()

    fireEvent.click(button)
    expect(handleStart).toHaveBeenCalledTimes(1)
  })
})
