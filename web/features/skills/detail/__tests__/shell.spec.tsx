import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DetailSkeleton } from '../shell'

describe('Skill detail shell', () => {
  it('renders the loading skeleton layout', () => {
    const { container } = render(<DetailSkeleton />)

    expect(container.firstChild).toHaveClass('flex', 'h-0', 'grow')
    expect(container.querySelectorAll('.opacity-20')).toHaveLength(2)
    expect(container.querySelectorAll('.opacity-10')).toHaveLength(3)
  })
})
