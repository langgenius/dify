import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import ArrayBoolList from '../array-bool-list'

function BooleanArrayEditor() {
  const [values, setValues] = useState([true])
  return (
    <>
      <ArrayBoolList list={values} onChange={setValues} />
      <output aria-label="Variable value">{JSON.stringify(values)}</output>
    </>
  )
}

it('updates, appends, and removes boolean values without losing existing edits', async () => {
  const user = userEvent.setup()
  render(<BooleanArrayEditor />)

  await user.click(screen.getByText('False'))
  expect(screen.getByLabelText('Variable value')).toHaveTextContent('[false]')
  await user.click(screen.getByText('True'))
  expect(screen.getByLabelText('Variable value')).toHaveTextContent('[true]')
  await user.click(
    screen.getByRole('button', { name: 'workflow.chatVariable.modal.addArrayValue' }),
  )
  expect(screen.getByLabelText('Variable value')).toHaveTextContent('[true,false]')
  await user.click(screen.getAllByRole('button', { name: 'common.operation.remove' })[0]!)
  expect(screen.getByLabelText('Variable value')).toHaveTextContent('[false]')
})
