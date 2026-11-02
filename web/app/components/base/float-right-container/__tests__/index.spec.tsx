import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import FloatRightContainer from '../index'

it('opens mobile content in a named drawer and closes it through the supplied action', async () => {
  const user = userEvent.setup()
  const onClose = vi.fn()
  function Harness() {
    const [open, setOpen] = useState(false)
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Open panel
        </button>
        <FloatRightContainer
          isMobile
          isOpen={open}
          title="Mobile panel"
          showClose
          onClose={() => {
            setOpen(false)
            onClose()
          }}
        >
          Mobile content
        </FloatRightContainer>
      </>
    )
  }
  render(<Harness />)
  await user.click(screen.getByRole('button', { name: 'Open panel' }))
  expect(await screen.findByRole('dialog', { name: 'Mobile panel' })).toBeInTheDocument()
  expect(screen.getByText('Mobile content')).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'common.operation.close' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(onClose).toHaveBeenCalledOnce()
})

it('shows desktop content inline only while open', () => {
  const { rerender } = render(
    <FloatRightContainer isMobile={false} isOpen onClose={vi.fn()} title="Drawer title">
      Desktop content
    </FloatRightContainer>,
  )
  expect(screen.getByText('Desktop content')).toBeVisible()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.queryByText('Drawer title')).not.toBeInTheDocument()
  rerender(
    <FloatRightContainer isMobile={false} isOpen={false} onClose={vi.fn()}>
      Desktop content
    </FloatRightContainer>,
  )
  expect(screen.queryByText('Desktop content')).not.toBeInTheDocument()
})
