import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
// index.spec.tsx
import { describe, expect, it, vi } from 'vitest'
import Group from './component/group'
import Radio from './index'

describe('Radio (index)', () => {
  it('attaches Group as a property on the default export', () => {
    expect(Radio.Group).toBe(Group)
  })

  it('renders Radio when used as a component', () => {
    render(<Radio>RootLabel</Radio>)
    expect(screen.getByText('RootLabel')).toBeInTheDocument()
    const label = screen.getByText('RootLabel')
    expect(label.tagName.toLowerCase()).toBe('label')
  })

  it('Radio.Group provides context to nested Radio and group onChange is called on click', async () => {
    const user = userEvent.setup()
    const groupOnChange = vi.fn()

    render(
      <Radio.Group value="val" onChange={groupOnChange}>
        <Radio value="val">InnerRadio</Radio>
      </Radio.Group>,
    )

    const root = screen.getByText('InnerRadio').closest('div') as HTMLElement
    await user.click(root)
    expect(groupOnChange).toHaveBeenCalledTimes(1)
    expect(groupOnChange).toHaveBeenCalledWith('val')
  })

  it('Radio.Group can render arbitrary children', () => {
    render(
      <Radio.Group value={undefined} onChange={() => {}}>
        <div data-testid="plain-child">child</div>
      </Radio.Group>,
    )
    expect(screen.getByTestId('plain-child')).toBeInTheDocument()
  })
})
