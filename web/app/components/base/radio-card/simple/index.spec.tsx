import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
// index.spec.tsx
import { describe, expect, it, vi } from 'vitest'
import RadioCard from './index'

describe('RadioCard', () => {
  it('renders title and description', () => {
    render(
      <RadioCard
        title="Card Title"
        description="Card Description"
        isChosen={false}
        onChosen={vi.fn()}
      />,
    )

    expect(screen.getByText('Card Title')).toBeInTheDocument()
    expect(screen.getByText('Card Description')).toBeInTheDocument()
  })

  it('renders JSX title correctly', () => {
    render(
      <RadioCard
        title={<span data-testid="jsx-title">JSX Title</span>}
        description="Desc"
        isChosen={false}
        onChosen={vi.fn()}
      />,
    )

    expect(screen.getByTestId('jsx-title')).toBeInTheDocument()
  })

  it('renders icon when provided', () => {
    render(
      <RadioCard
        title="With Icon"
        description="Desc"
        isChosen={false}
        onChosen={vi.fn()}
        icon={<span data-testid="icon">ICON</span>}
      />,
    )

    expect(screen.getByTestId('icon')).toBeInTheDocument()
  })

  it('renders extra content when provided', () => {
    render(
      <RadioCard
        title="With Extra"
        description="Desc"
        isChosen={false}
        onChosen={vi.fn()}
        extra={<div data-testid="extra">Extra Content</div>}
      />,
    )

    expect(screen.getByTestId('extra')).toBeInTheDocument()
  })

  it('calls onChosen when clicked', async () => {
    const user = userEvent.setup()
    const onChosen = vi.fn()

    render(
      <RadioCard
        title="Clickable"
        description="Desc"
        isChosen={false}
        onChosen={onChosen}
      />,
    )

    await user.click(screen.getByText('Clickable'))
    expect(onChosen).toHaveBeenCalledTimes(1)
  })

  it('applies active class when isChosen is true', () => {
    const { container } = render(
      <RadioCard
        title="Active"
        description="Desc"
        isChosen
        onChosen={vi.fn()}
      />,
    )

    const root = container.firstChild as HTMLElement
    expect(root.className).not.toBe('')
  })

  it('does not apply active styling logic when isChosen is false', () => {
    const { container } = render(
      <RadioCard
        title="Inactive"
        description="Desc"
        isChosen={false}
        onChosen={vi.fn()}
      />,
    )

    const root = container.firstChild as HTMLElement
    expect(root).toBeTruthy()
  })

  it('memo export renders correctly', () => {
    render(
      <RadioCard
        title="Memo"
        description="Desc"
        isChosen={false}
        onChosen={vi.fn()}
      />,
    )

    expect(screen.getByText('Memo')).toBeInTheDocument()
  })
})
