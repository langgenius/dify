import type { AppType } from '@/app/components/apps/app-type'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import AppTypeSelector from '../index'

it('adds and removes selected app types, then clears them without reopening the menu', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  function Types() {
    const [value, setValue] = useState<AppType[]>([])
    return (
      <AppTypeSelector
        value={value}
        onChange={(next) => {
          setValue(next)
          onChange(next)
        }}
      />
    )
  }
  render(<Types />)
  await user.click(screen.getByRole('button', { name: 'app.typeSelector.all' }))
  const options = within(screen.getByRole('list'))
  await user.click(options.getByRole('button', { name: 'app.typeSelector.workflow' }))
  expect(onChange).toHaveBeenLastCalledWith(['workflow'])
  await user.click(options.getByRole('button', { name: 'app.typeSelector.agent' }))
  expect(onChange).toHaveBeenLastCalledWith(['workflow', 'agent-chat'])
  await user.click(options.getByRole('button', { name: 'app.typeSelector.workflow' }))
  expect(onChange).toHaveBeenLastCalledWith(['agent-chat'])
  await user.keyboard('{Escape}')
  await user.click(screen.getByRole('button', { name: 'common.operation.clear' }))
  expect(onChange).toHaveBeenLastCalledWith([])
  expect(screen.getByRole('button', { name: 'app.typeSelector.all' })).toBeInTheDocument()
  expect(screen.queryByRole('list')).not.toBeInTheDocument()
})
