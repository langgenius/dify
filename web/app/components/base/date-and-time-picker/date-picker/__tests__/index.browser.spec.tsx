import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import dayjs from '../../utils/dayjs'
import DatePicker from '../index'

describe('DatePicker browser interactions', () => {
  it('closes when focus moves backward past the trigger', async () => {
    // Chromium owns the native focus event order used by Base UI's focus guards.
    const screen = await render(
      <>
        <button type="button">Before picker</button>
        <DatePicker value={dayjs('2024-06-15')} onChange={() => {}} onClear={() => {}} />
      </>,
    )

    const trigger = screen.getByRole('button', { name: /time.defaultPlaceholder/ })
    await trigger.click()
    await expect.element(screen.getByRole('dialog')).toBeVisible()

    await userEvent.tab({ shift: true })

    expect(trigger.element()).toHaveFocus()
    await expect.element(screen.getByRole('dialog')).toBeVisible()

    await userEvent.tab({ shift: true })

    expect(screen.getByRole('button', { name: 'Before picker' }).element()).toHaveFocus()
    await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
  })
})
