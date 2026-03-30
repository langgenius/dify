import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import ResPlaceholder from '../res-placeholder'

describe('ResPlaceholder', () => {
  it('should render the empty-state copy', () => {
    render(<ResPlaceholder />)

    expect(screen.getByText('appDebug.generate.newNoDataLine1')).toBeInTheDocument()
  })
})
