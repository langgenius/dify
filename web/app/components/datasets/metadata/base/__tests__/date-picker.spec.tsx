import type { ReactElement } from 'react'
import { render as rtlRender, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createAccountProfileQueryWrapper } from '@/test/console/account-profile'
import InputCombined from '../../edit-metadata-batch/input-combined'
import { DataType } from '../../types'
import WrappedDatePicker from '../date-picker'

vi.mock('@/hooks/use-timestamp', () => ({
  default: () => ({ formatTime: (timestamp: number) => new Date(timestamp * 1000).toISOString() }),
}))
const render = (ui: ReactElement) => rtlRender(ui, { wrapper: createAccountProfileQueryWrapper() })

describe('Metadata date field', () => {
  it('keeps a read-only metadata date focusable without editing or clearing it', async () => {
    const user = userEvent.setup()
    const changed = vi.fn()
    render(
      <InputCombined
        label="Published"
        type={DataType.time}
        value={1736947800}
        onChange={changed}
        readOnly
      />,
    )
    const trigger = screen.getByRole('button', { name: /^Published/ })
    await user.tab()
    expect(trigger).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'common.operation.clear' })).not.toBeInTheDocument()
    expect(changed).not.toHaveBeenCalled()
  })
  it('keeps an empty field empty when opening and dismissing the calendar', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<WrappedDatePicker label="Published" onChange={onChange} />)
    const trigger = screen.getByRole('button', { name: /^Published/ })
    await user.click(trigger)
    expect(await screen.findByRole('dialog', { name: 'Published' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(onChange).not.toHaveBeenCalled()
    await waitFor(() => expect(trigger).toHaveFocus())
  })
  it('treats Unix epoch zero as a value and returns focus after clearing it', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<WrappedDatePicker label="Published" value={0} onChange={onChange} />)
    const trigger = screen.getByRole('button', { name: /Published 1970-01-01/ })
    await user.click(screen.getByRole('button', { name: 'common.operation.clear' }))
    expect(onChange).toHaveBeenCalledExactlyOnceWith(null)
    expect(trigger).toHaveFocus()
  })
  it('commits the selected date as Unix seconds only after confirmation', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<WrappedDatePicker label="Published" value={1736947800} onChange={onChange} />)
    await user.click(screen.getByRole('button', { name: /^Published/ }))
    await user.click(await screen.findByRole('button', { name: /January 16/ }))
    expect(onChange).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'time.operation.ok' }))
    expect(onChange).toHaveBeenCalledExactlyOnceWith(1737034200)
  })
})
