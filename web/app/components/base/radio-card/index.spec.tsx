import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
// index.spec.tsx
import { describe, expect, it, vi } from 'vitest'
import RadioCard from './index'

describe('RadioCard', () => {
  it('renders icon, title and description', () => {
    render(
      <RadioCard
        icon={<span data-testid="icon">ICON</span>}
        title="Card Title"
        description="Some description"
      />,
    )

    expect(screen.getByTestId('icon')).toBeInTheDocument()
    expect(screen.getByText('Card Title')).toBeInTheDocument()
    expect(screen.getByText('Some description')).toBeInTheDocument()
  })

  it('calls onChosen when clicked', async () => {
    const user = userEvent.setup()
    const onChosen = vi.fn()

    render(
      <RadioCard
        icon={<span>i</span>}
        title="Clickable"
        description="desc"
        onChosen={onChosen}
      />,
    )

    await user.click(screen.getByText('Clickable'))
    expect(onChosen).toHaveBeenCalledTimes(1)
  })

  it('hides radio element when noRadio is true and still shows chosen-config area (wrapper)', () => {
    const { container } = render(
      <RadioCard
        icon={<span>i</span>}
        title="No Radio"
        description="desc"
        noRadio
      />,
    )

    const radioWrapper = container.querySelector('.absolute.right-3.top-3')
    expect(radioWrapper).toBeNull()

    // chosen-config area should appear because noRadio true triggers the block
    const chosenArea = container.querySelector('.mt-2')
    expect(chosenArea).toBeTruthy()
  })

  it('shows radio checked styles when isChosen and shows chosenConfig', () => {
    const { container } = render(
      <RadioCard
        icon={<span>i</span>}
        title="Chosen"
        description="desc"
        isChosen
        chosenConfig={<div data-testid="chosen-config">config</div>}
      />,
    )

    // radio absolute wrapper exists
    const radioWrapper = container.querySelector('.absolute.right-3.top-3')
    expect(radioWrapper).toBeTruthy()

    // inner circle div should have checked fragment in class list
    const inner = radioWrapper?.querySelector('div')
    expect(inner).toBeTruthy()
    expect(inner?.className).toContain('border-components-radio-border-checked')

    // chosenConfig rendered
    expect(screen.getByTestId('chosen-config')).toBeInTheDocument()
  })

  it('applies custom className to root and merges chosenConfigWrapClassName', () => {
    const { container } = render(
      <RadioCard
        icon={<span>i</span>}
        title="Custom"
        description="desc"
        className="my-root-class"
        isChosen
        chosenConfig={<div>cfg</div>}
        chosenConfigWrapClassName="my-config-wrap"
      />,
    )

    const root = container.firstChild as HTMLElement
    expect(root).toBeTruthy()
    expect(root.className).toContain('my-root-class')
    expect(root.className).toContain('border-[1.5px]')
    expect(root.className).toContain('bg-components-option-card-option-selected-bg')

    const chosenWrap = container.querySelector('.mt-2 .my-config-wrap')
    expect(chosenWrap).toBeTruthy()
    expect(chosenWrap?.textContent).toBe('cfg')
  })

  it('does not render radio when noRadio true and still allows clicking on whole card', async () => {
    const user = userEvent.setup()
    const onChosen = vi.fn()

    const { container } = render(
      <RadioCard
        icon={<span>i</span>}
        title="ClickNoRadio"
        description="desc"
        noRadio
        onChosen={onChosen}
      />,
    )

    // click title should trigger onChosen
    await user.click(screen.getByText('ClickNoRadio'))
    expect(onChosen).toHaveBeenCalledTimes(1)

    // radio area should be absent
    expect(container.querySelector('.absolute.right-3.top-3')).toBeNull()
  })

  it('memo export renders correctly', () => {
    render(
      <RadioCard
        icon={<span>i</span>}
        title="Memo"
        description="desc"
      />,
    )
    expect(screen.getByText('Memo')).toBeInTheDocument()
  })
})
