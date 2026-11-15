import { createEvent, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { VariableMenuItem } from '../variable-option'

it.each(['System Variable', 'İstanbul System Variable'])(
  'selects the case-insensitive match in "%s" without losing its full label',
  async (title) => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    const onMouseEnter = vi.fn()
    render(
      <VariableMenuItem
        title={title}
        queryString="TEM"
        isSelected={false}
        onClick={onClick}
        onMouseEnter={onMouseEnter}
      />,
    )
    const option = screen.getByRole('option', { name: title })
    expect(option).toHaveTextContent(title)
    expect(screen.getByText('tem')).toBeInTheDocument()
    await user.hover(option)
    await user.click(option)
    expect(onMouseEnter).toHaveBeenCalledOnce()
    expect(onClick).toHaveBeenCalledOnce()
  },
)

it.each(['[', '(', '\\', '.*'])(
  'highlights "%s" as literal text without changing the label',
  (queryString) => {
    const title = `Before ${queryString} after`
    render(
      <VariableMenuItem
        title={title}
        queryString={queryString}
        isSelected={false}
        onClick={vi.fn()}
        onMouseEnter={vi.fn()}
      />,
    )

    expect(screen.getByRole('option', { name: title })).toHaveTextContent(title)
    expect(screen.getByText(queryString)).toBeInTheDocument()
  },
)

it.each(['', 'missing'])('keeps the full label when the query is "%s"', (queryString) => {
  render(
    <VariableMenuItem
      title="Variable"
      queryString={queryString}
      isSelected={false}
      onClick={vi.fn()}
      onMouseEnter={vi.fn()}
    />,
  )

  expect(screen.getByRole('option', { name: 'Variable' })).toHaveTextContent('Variable')
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
  const target = screen.getByRole('option', { name: 'Variable' })
  const event = createEvent.mouseDown(target)
  fireEvent(target, event)
  expect(event.defaultPrevented).toBe(true)
  expect(onParentMouseDown).not.toHaveBeenCalled()
})
