import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
// index.spec.tsx
import { describe, expect, it, vi } from 'vitest'
import RadioGroupContext from '../../context'
import Radio from './index'

describe('Radio component', () => {
  it('renders label children and assigns an id to the label', () => {
    const { container } = render(<Radio>My Label</Radio>)

    const label = screen.getByText('My Label')
    expect(label).toBeInTheDocument()
    // label must be an HTMLLabelElement with an id assigned by useId
    expect(label.tagName.toLowerCase()).toBe('label')
    expect(label).toHaveAttribute('id')
    const root = container.firstChild as HTMLElement
    expect(root).toBeTruthy()
  })

  it('does not render a label when children is falsey', () => {
    render(<Radio />)
    // there should be no <label> in the document
    const labels = screen.queryAllByRole('label')
    expect(labels.length).toBe(0)
    // also ensure no textual children
    expect(screen.queryByText(/./)).toBeNull()
  })

  it('calls both local onChange and group onChange when clicked', async () => {
    const user = userEvent.setup()
    const localChange = vi.fn()
    const groupChange = vi.fn()

    render(
      <RadioGroupContext.Provider value={{ value: null, onChange: groupChange }}>
        <Radio value="v1" onChange={localChange}>
          ClickMe
        </Radio>
      </RadioGroupContext.Provider>,
    )

    const root = screen.getByText('ClickMe').closest('div') as HTMLElement
    await user.click(root)
    expect(localChange).toHaveBeenCalledTimes(1)
    expect(localChange).toHaveBeenCalledWith('v1')
    expect(groupChange).toHaveBeenCalledTimes(1)
    expect(groupChange).toHaveBeenCalledWith('v1')
  })

  it('does not call onChange handlers when disabled', async () => {
    const user = userEvent.setup()
    const localChange = vi.fn()
    const groupChange = vi.fn()

    render(
      <RadioGroupContext.Provider value={{ value: null, onChange: groupChange }}>
        <Radio value="v2" onChange={localChange} disabled>
          DisabledLabel
        </Radio>
      </RadioGroupContext.Provider>,
    )

    const root = screen.getByText('DisabledLabel').closest('div') as HTMLElement
    await user.click(root)
    expect(localChange).not.toHaveBeenCalled()
    expect(groupChange).not.toHaveBeenCalled()
  })

  it('uses group value to determine checked state and applies checked class fragment', () => {
    const { container: c1 } = render(
      <RadioGroupContext.Provider value={{ value: 'yes', onChange: () => {} }}>
        <Radio value="yes">CheckedByGroup</Radio>
      </RadioGroupContext.Provider>,
    )
    const root1 = c1.firstChild as HTMLElement
    expect(root1).toBeTruthy()
    // component conditionally adds the 'bg-components-option-card-option-bg-hover' fragment when checked
    expect(root1.className).toContain('bg-components-option-card-option-bg-hover')

    const { container: c2 } = render(<Radio checked>CheckedByProp</Radio>)
    const root2 = c2.firstChild as HTMLElement
    expect(root2).toBeTruthy()
    expect(root2.className).toContain('bg-components-option-card-option-bg-hover')
  })

  it('merges custom className with component classes', () => {
    const { container } = render(<Radio className="my-custom-class">Label</Radio>)
    const root = container.firstChild as HTMLElement
    expect(root).toBeInTheDocument()
    expect(root.className).toContain('my-custom-class')
    // ensure other classes still exist (merged)
    expect(root.className.length).toBeGreaterThan('my-custom-class'.length)
  })
})
