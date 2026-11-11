import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { DataType } from '../../types'
import { CreateMetadataModal } from '../create-metadata-modal'

function Harness({ onSave = vi.fn(), hasBack = false }) {
  const [open, setOpen] = useState(false)
  return (
    <CreateMetadataModal
      open={open}
      setOpen={setOpen}
      hasBack={hasBack}
      trigger={<button>Add metadata</button>}
      onSave={onSave}
    />
  )
}

it('saves the selected metadata type and entered name from the actual creation form', async () => {
  const user = userEvent.setup()
  const onSave = vi.fn()
  render(<Harness onSave={onSave} />)
  await user.click(screen.getByRole('button', { name: 'Add metadata' }))
  await user.click(await screen.findByRole('radio', { name: 'Number' }))
  await user.type(
    screen.getByRole('textbox', { name: 'dataset.metadata.createMetadata.name' }),
    'page_count',
  )
  await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
  expect(onSave).toHaveBeenCalledWith({ type: DataType.number, name: 'page_count' })
})

it.each([false, true])(
  'dismisses an edited draft using hasBack=%s without saving',
  async (hasBack) => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(<Harness onSave={onSave} hasBack={hasBack} />)
    await user.click(screen.getByRole('button', { name: 'Add metadata' }))
    await user.type(
      await screen.findByRole('textbox', { name: 'dataset.metadata.createMetadata.name' }),
      'draft',
    )
    await user.click(
      screen.getByRole('button', {
        name: hasBack ? 'dataset.metadata.createMetadata.back' : 'common.operation.close',
      }),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(onSave).not.toHaveBeenCalled()
  },
)
