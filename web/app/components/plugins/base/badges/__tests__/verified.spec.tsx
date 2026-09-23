import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vite-plus/test'
import Verified from '../verified'

vi.mock('@/hooks/use-theme', () => ({
  default: () => ({ theme: 'light' }),
}))

describe('Verified', () => {
  it('exposes the verification meaning before opening the tooltip', () => {
    render(<Verified text="Verified Plugin" />)
    expect(screen.getByText('Verified Plugin')).toBeInTheDocument()
  })
})
