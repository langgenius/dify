import { createEvent, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { VariableMenuItem } from '../variable-option'

it('selects the matching variable without losing its full label', async () => {
  const user = userEvent.setup()
  const onClick = vi.fn()
  const onMouseEnter = vi.fn()
  render(
    <VariableMenuItem
      title="System Variable"
      queryString="TEM"
      isSelected={false}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
    />,
  )
  const option = screen.getByTitle('System Variable')
  expect(option).toHaveTextContent('System Variable')
  await user.hover(option)
  await user.click(option)
  expect(onMouseEnter).toHaveBeenCalledOnce()
  expect(onClick).toHaveBeenCalledOnce()
})

it('consumes mousedown so a variable choice does not disturb the editor selection', () => {
  const onParentMouseDown = vi.fn()
  render(
    <div role="presentation" onMouseDown={onParentMouseDown}>
      <VariableMenuItem
        title="Variable"
        queryString={null}
        isSelected={false}
        onClick={vi.fn()}
        onMouseEnter={vi.fn()}
      />
    </div>,
  )
  const target = screen.getByText('Variable')
  const event = createEvent.mouseDown(target)
  fireEvent(target, event)
  expect(event.defaultPrevented).toBe(true)
  expect(onParentMouseDown).not.toHaveBeenCalled()
})
