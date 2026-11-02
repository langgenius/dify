import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FieldTitle } from '../field-title'

it('names the explanation from the field title', async () => {
  const user = userEvent.setup()
  render(<FieldTitle title="Embedding" tooltip="Choose the embedding model" />)
  await user.click(screen.getByRole('button', { name: 'Embedding' }))
  expect(await screen.findByRole('dialog', { name: 'Embedding' })).toHaveTextContent(
    'Choose the embedding model',
  )
})

it('toggles local collapse state and stops changing it when disabled', async () => {
  const user = userEvent.setup()
  const onCollapse = vi.fn()
  const { rerender } = render(<FieldTitle title="Models" showArrow onCollapse={onCollapse} />)
  await user.click(screen.getByText('Models'))
  expect(onCollapse).toHaveBeenLastCalledWith(false)
  await user.click(screen.getByText('Models'))
  expect(onCollapse).toHaveBeenLastCalledWith(true)

  rerender(
    <FieldTitle title="Models" showArrow collapsed={false} disabled onCollapse={onCollapse} />,
  )
  await user.click(screen.getByText('Models'))
  expect(onCollapse).toHaveBeenCalledTimes(2)
})
