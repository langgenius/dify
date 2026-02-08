import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import EmptyFolder from './empty-folder'

// Mock react-i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

afterEach(() => {
  cleanup()
})

describe('EmptyFolder', () => {
  it('should render without crashing', () => {
    render(<EmptyFolder />)
    expect(screen.getByText('onlineDrive.emptyFolder')).toBeInTheDocument()
  })

  it('should render the empty folder text', () => {
    render(<EmptyFolder />)
    expect(screen.getByText('onlineDrive.emptyFolder')).toBeInTheDocument()
  })

  it('should have proper styling classes', () => {
    const { container } = render(<EmptyFolder />)
    const wrapper = container.firstChild as HTMLElement
    expect(wrapper).toHaveClass('flex')
    expect(wrapper).toHaveClass('items-center')
    expect(wrapper).toHaveClass('justify-center')
  })

  it('should be wrapped with React.memo', () => {
    expect((EmptyFolder as unknown as { $$typeof: symbol }).$$typeof).toBe(Symbol.for('react.memo'))
  })
})
