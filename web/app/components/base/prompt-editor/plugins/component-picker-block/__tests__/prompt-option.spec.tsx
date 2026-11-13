import { createEvent, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PromptMenuItem } from '../prompt-option'

it('ignores selection and hover while disabled, then enables both actions', async () => {
  const user = userEvent.setup()
  const onClick = vi.fn()
  const onMouseEnter = vi.fn()
  const props = {
    icon: <span />,
    title: 'Insert variable',
    isSelected: false,
    onClick,
    onMouseEnter,
  }
  const { rerender } = render(<PromptMenuItem {...props} disabled />)
  const option = screen.getByText('Insert variable')
  await user.hover(option)
  await user.click(option)
  expect(onClick).not.toHaveBeenCalled()
  expect(onMouseEnter).not.toHaveBeenCalled()
  await user.unhover(option)
  rerender(<PromptMenuItem {...props} />)
  await user.hover(option)
  await user.click(option)
  expect(onMouseEnter).toHaveBeenCalledOnce()
  expect(onClick).toHaveBeenCalledOnce()
})

it('consumes mousedown so the picker does not move the editor selection or notify its parent', () => {
  const onParentMouseDown = vi.fn()
  render(
    <div role="presentation" onMouseDown={onParentMouseDown}>
      <PromptMenuItem
        icon={<span />}
        title="Insert variable"
        isSelected={false}
        onClick={vi.fn()}
        onMouseEnter={vi.fn()}
      />
    </div>,
  )
  const event = createEvent.mouseDown(screen.getByText('Insert variable'))
  fireEvent(screen.getByText('Insert variable'), event)
  expect(event.defaultPrevented).toBe(true)
  expect(onParentMouseDown).not.toHaveBeenCalled()
})
