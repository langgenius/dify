import { render } from '@testing-library/react'
import { describe, expect, it } from 'vite-plus/test'
import { DetailSkeleton } from '../shell'

describe('Skill detail shell', () => {
  it('renders the loading skeleton layout', () => {
    const { container } = render(<DetailSkeleton />)

    expect(container.firstChild).toHaveAttribute('aria-busy', 'true')
  })
})
