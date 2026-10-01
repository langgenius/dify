import { arTN } from '@daypicker/react/locale/ar-TN'
import { faIR } from '@daypicker/react/locale/fa-IR'
import * as React from 'react'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { DirectionProvider } from '../../../direction-provider'
import {
  DatePicker,
  DatePickerClear,
  DatePickerContent,
  DatePickerLabel,
  DatePickerTrigger,
} from '../index'

function Parts() {
  return (
    <React.Fragment>
      <DatePickerTrigger />
      <DatePickerClear aria-label="Clear date" />
      <DatePickerContent />
    </React.Fragment>
  )
}

describe('DatePicker keyboard and form contract', () => {
  it('keeps a focus-only label associated across label mounting and custom trigger IDs', async () => {
    function Example() {
      const [visible, setVisible] = React.useState(true)
      return (
        <React.Fragment>
          <button type="button" onClick={() => setVisible(!visible)}>
            Toggle label
          </button>
          <DatePicker defaultValue="2025-01-15">
            {visible && <DatePickerLabel>Departure</DatePickerLabel>}
            <DatePickerTrigger id="custom-departure" aria-label={visible ? undefined : 'Date'} />
            <DatePickerContent aria-label={visible ? undefined : 'Choose date'} />
          </DatePicker>
        </React.Fragment>
      )
    }
    const screen = await render(<Example />)
    const toggle = screen.getByRole('button', { name: 'Toggle label' })
    const trigger = screen.getByRole('button', { name: 'Departure Jan 15, 2025' })
    await screen.getByText('Departure', { exact: true }).click()
    await expect.element(trigger).toHaveFocus()
    await expect.element(trigger).toHaveAttribute('aria-expanded', 'false')
    await toggle.click()
    await expect.element(screen.getByRole('button', { name: 'Date' })).toBeInTheDocument()
    await toggle.click()
    await userEvent.tab()
    await expect.element(trigger).toHaveFocus()
    await userEvent.keyboard(' ')
    await expect
      .element(screen.getByRole('dialog', { name: 'Departure', exact: true }))
      .toBeInTheDocument()
  })

  it.each(['disabled', 'readOnly'] as const)(
    'respects %s when activating the label',
    async (state) => {
      const screen = await render(
        <DatePicker {...{ [state]: true }}>
          <DatePickerLabel>Date</DatePickerLabel>
          <Parts />
        </DatePicker>,
      )
      await screen.getByText('Date', { exact: true }).click()
      const trigger = screen.getByRole('button', { name: 'Date', exact: true })
      if (state === 'disabled') await expect.element(trigger).not.toHaveFocus()
      else await expect.element(trigger).toHaveFocus()
      await expect.element(trigger).toHaveAttribute('aria-expanded', 'false')
      await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
    },
  )

  it('explains an unavailable month draft and lets the user repair it without committing a date', async () => {
    const changed = vi.fn()
    const screen = await render(
      <DatePicker
        defaultValue="2025-04-15"
        minDate="2025-03-01"
        maxDate="2025-12-31"
        onValueChange={changed}
      >
        <DatePickerLabel className="sr-only">Date</DatePickerLabel>
        <Parts />
      </DatePicker>,
    )
    await screen.getByRole('button', { name: 'Date Apr 15, 2025' }).click()
    await screen.getByRole('button', { name: /Choose month and year:/ }).click()
    await userEvent.keyboard('{Home}')
    await expect.element(screen.getByRole('button', { name: 'OK' })).toBeDisabled()
    await expect.element(screen.getByRole('status')).toHaveTextContent('This date is unavailable.')
    await expect
      .element(screen.getByRole('group', { name: 'Choose month and year' }))
      .toHaveAccessibleDescription('This date is unavailable.')
    await userEvent.keyboard('{ArrowDown}{ArrowDown}')
    await expect.element(screen.getByRole('button', { name: 'OK' })).toBeEnabled()
    await expect.element(screen.getByRole('status')).not.toBeInTheDocument()
    await screen.getByRole('button', { name: 'OK' }).click()
    await expect
      .element(screen.getByRole('button', { name: 'Choose month and year: March 2025' }))
      .toBeInTheDocument()
    expect(changed).not.toHaveBeenCalled()
  })

  it('toggles month selection from the title without applying its draft or resizing the popup', async () => {
    const changed = vi.fn()
    const screen = await render(
      <DatePicker defaultValue="2025-01-15" onValueChange={changed}>
        <DatePickerLabel className="sr-only">Date</DatePickerLabel>
        <Parts />
      </DatePicker>,
    )
    await screen.getByRole('button', { name: 'Date Jan 15, 2025' }).click()
    const popup = screen.getByRole('dialog', { name: 'Date', exact: true })
    await expect.poll(() => popup.element().getBoundingClientRect().height).toBe(252)
    const height = popup.element().getBoundingClientRect().height
    const title = screen.getByRole('button', { name: 'Choose month and year: January 2025' })
    const titleBounds = title.element().getBoundingClientRect()
    await expect.element(title).toHaveAttribute('aria-expanded', 'false')
    await title.click()
    await expect.element(title).toHaveAttribute('aria-expanded', 'true')
    const columns = screen.getByRole('group', { name: 'Choose month and year' })
    expect(title.element().getAttribute('aria-controls')).toBe(columns.element().id)
    expect(popup.element().getBoundingClientRect().height).toBe(height)
    expect(title.element().getBoundingClientRect().top).toBe(titleBounds.top)
    expect(title.element().getBoundingClientRect().left).toBe(titleBounds.left)
    await userEvent.keyboard('{ArrowDown}')
    await title.click()
    await expect.element(title).toHaveFocus()
    await expect.element(title).toHaveAttribute('aria-expanded', 'false')
    await expect.element(screen.getByRole('grid')).toBeInTheDocument()
    expect(popup.element().getBoundingClientRect().height).toBe(height)
    await userEvent.keyboard('{Enter}')
    await expect
      .element(
        screen.getByRole('listbox', { name: 'Month' }).getByRole('option', { name: 'January' }),
      )
      .toHaveFocus()
    await userEvent.tab({ shift: true })
    await expect.element(title).toHaveFocus()
    await userEvent.keyboard(' ')
    await expect.element(title).toHaveAttribute('aria-expanded', 'false')
    await expect.element(title).toHaveFocus()
    expect(changed).not.toHaveBeenCalled()
  })

  it('moves into month selection, locates a year numerically, and returns focus to the calendar', async () => {
    const screen = await render(
      <DatePicker defaultValue="2025-01-15">
        <DatePickerLabel className="sr-only">Date</DatePickerLabel>
        <Parts />
      </DatePicker>,
    )
    await screen.getByRole('button', { name: 'Date Jan 15, 2025' }).click()
    await screen.getByRole('button', { name: /Choose month and year/ }).click()
    const months = screen.getByRole('listbox', { name: 'Month' })
    await expect.element(months.getByRole('option', { name: 'January', exact: true })).toHaveFocus()
    await userEvent.keyboard('12')
    await expect
      .element(months.getByRole('option', { name: 'December', exact: true }))
      .toHaveAttribute('aria-selected', 'true')
    await userEvent.keyboard('{Home}mar')
    await expect.element(months.getByRole('option', { name: 'March', exact: true })).toHaveFocus()
    await userEvent.keyboard('{End}')
    await userEvent.tab()
    await userEvent.keyboard('2037')
    await expect.element(screen.getByRole('option', { name: '2037', exact: true })).toHaveFocus()
    await screen.getByRole('button', { name: 'OK', exact: true }).click()
    await expect.element(screen.getByRole('grid')).toBeInTheDocument()
    await expect.poll(() => document.activeElement?.closest('[role="grid"]') !== null).toBe(true)
    await expect
      .element(screen.getByRole('button', { name: /Choose month and year: December 2037/ }))
      .toBeInTheDocument()
  })

  it('keeps a single tab stop in the grid and skips unavailable days', async () => {
    const screen = await render(
      <DatePicker
        defaultValue="2025-01-15"
        minDate="2025-01-14"
        maxDate="2025-01-31"
        isDateUnavailable={(date) => date === '2025-01-16'}
      >
        <DatePickerLabel className="sr-only">Date</DatePickerLabel>
        <Parts />
      </DatePicker>,
    )
    await screen.getByRole('button', { name: /^Date Jan/ }).click()
    await userEvent.keyboard('{ArrowRight}')
    expect(document.activeElement?.getAttribute('aria-label')).toMatch(/January 17/)
    expect(document.querySelectorAll('[role="grid"] button[tabindex="0"]')).toHaveLength(1)
    await expect.element(screen.getByRole('button', { name: 'Previous month' })).toBeDisabled()
    await expect.element(screen.getByRole('button', { name: 'Next month' })).toBeDisabled()
    await userEvent.keyboard('{Escape}')
    await expect.element(screen.getByRole('button', { name: /^Date Jan/ })).toHaveFocus()
  })

  it('validates a required value, serializes a civil date, and resets to the initial value', async () => {
    const submitted = vi.fn()
    const screen = await render(
      <form
        onSubmit={(event) => {
          event.preventDefault()
          submitted(new FormData(event.currentTarget).get('date'))
        }}
      >
        <DatePicker name="date" required validationMessage="Choose a date">
          <DatePickerLabel className="sr-only">Date</DatePickerLabel>
          <Parts />
        </DatePicker>
        <button type="submit">Submit</button>
        <button type="reset">Reset</button>
      </form>,
    )
    await screen.getByRole('button', { name: 'Submit' }).click()
    expect(submitted).not.toHaveBeenCalled()
    await expect.element(screen.getByRole('button', { name: 'Date', exact: true })).toHaveFocus()
    await expect.element(screen.getByRole('alert')).toHaveTextContent('Choose a date')
    await screen.getByRole('button', { name: 'Date', exact: true }).click()
    await userEvent.keyboard('{Enter}')
    await screen.getByRole('button', { name: 'Submit' }).click()
    expect(submitted).toHaveBeenCalledWith(expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/))
    await screen.getByRole('button', { name: 'Reset' }).click()
    await expect
      .element(screen.getByRole('button', { name: 'Date', exact: true }))
      .toBeInTheDocument()
    await expect.element(screen.getByRole('button', { name: 'Clear date' })).not.toBeInTheDocument()
  })

  it.each(['aria-label', 'aria-labelledby'] as const)(
    'clears through a %s named button and restores trigger focus',
    async (naming) => {
      const changed = vi.fn()
      const screen = await render(
        <DatePicker defaultValue="2025-01-15" onValueChange={changed}>
          <DatePickerLabel className="sr-only">Date</DatePickerLabel>
          <div>
            <DatePickerTrigger />
            <span id="clear-date-text" className="sr-only">
              Clear date
            </span>
            <DatePickerClear
              {...(naming === 'aria-label'
                ? { 'aria-label': 'Clear date' }
                : { 'aria-labelledby': 'clear-date-text' })}
            />
          </div>
          <DatePickerContent />
        </DatePicker>,
      )
      await screen.getByRole('button', { name: 'Clear date' }).click()
      expect(changed).toHaveBeenCalledExactlyOnceWith(null)
      await expect.element(screen.getByRole('button', { name: 'Date', exact: true })).toHaveFocus()
      await expect
        .element(screen.getByRole('button', { name: 'Clear date' }))
        .not.toBeInTheDocument()
      await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
    },
  )

  it('keeps read-only values in form data while preventing edits', async () => {
    const onChange = vi.fn()
    const screen = await render(
      <form id="readonly-form">
        <DatePicker name="date" readOnly defaultValue="2025-01-15" onValueChange={onChange}>
          <DatePickerLabel className="sr-only">Date</DatePickerLabel>
          <Parts />
        </DatePicker>
      </form>,
    )
    const trigger = screen.getByRole('button', { name: /^Date Jan/ })
    await userEvent.tab()
    await expect.element(trigger).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
    expect(
      new FormData(document.querySelector<HTMLFormElement>('#readonly-form')!).get('date'),
    ).toBe('2025-01-15')
    expect(onChange).not.toHaveBeenCalled()
  })
})

it('moves across an adjacent month with the keyboard', async () => {
  const screen = await render(
    <DatePicker defaultValue="2025-01-31">
      <DatePickerLabel className="sr-only">Date</DatePickerLabel>
      <Parts />
    </DatePicker>,
  )
  await screen.getByRole('button', { name: 'Date Jan 31, 2025' }).click()
  await userEvent.keyboard('{ArrowRight}')
  await expect
    .element(screen.getByRole('button', { name: 'Saturday, February 1st, 2025', exact: true }))
    .toHaveFocus()
  await expect.element(screen.getByRole('status')).toHaveTextContent('February 2025')
  expect(
    Array.from(document.querySelectorAll('[aria-live="polite"]')).filter(
      (element) => element.textContent === 'February 2025',
    ),
  ).toHaveLength(1)
  await userEvent.keyboard('{Enter}')
  await expect.element(screen.getByRole('button', { name: 'Date Feb 1, 2025' })).toHaveFocus()
})

it('opens on the allowed month and retains a visible focus target if every date is unavailable', async () => {
  const screen = await render(
    <DatePicker minDate="2037-02-01" maxDate="2037-02-28" isDateUnavailable={() => true}>
      <DatePickerLabel className="sr-only">Date</DatePickerLabel>
      <Parts />
    </DatePicker>,
  )
  await screen.getByRole('button', { name: 'Date', exact: true }).click()
  await expect
    .element(screen.getByRole('button', { name: 'Choose month and year: February 2037' }))
    .toHaveFocus()
})

it('keeps adjacent-month dates selectable by pointer', async () => {
  const screen = await render(
    <DatePicker defaultValue="2025-01-15">
      <DatePickerLabel className="sr-only">Date</DatePickerLabel>
      <Parts />
    </DatePicker>,
  )
  await screen.getByRole('button', { name: 'Date Jan 15, 2025' }).click()
  await screen.getByRole('button', { name: 'Saturday, February 1st, 2025', exact: true }).click()
  await expect.element(screen.getByRole('button', { name: 'Date Feb 1, 2025' })).toHaveFocus()
})

it('supports month/year paging and week endpoints without committing during navigation', async () => {
  const changed = vi.fn()
  const screen = await render(
    <DatePicker defaultValue="2025-01-31" onValueChange={changed}>
      <DatePickerLabel className="sr-only">Date</DatePickerLabel>
      <Parts />
    </DatePicker>,
  )
  await screen.getByRole('button', { name: 'Date Jan 31, 2025' }).click()
  await userEvent.keyboard('{PageDown}')
  await expect
    .element(screen.getByRole('button', { name: 'Friday, February 28th, 2025', exact: true }))
    .toHaveFocus()
  await userEvent.keyboard('{Shift>}{PageDown}{/Shift}')
  await expect
    .element(screen.getByRole('button', { name: 'Saturday, February 28th, 2026', exact: true }))
    .toHaveFocus()
  await userEvent.keyboard('{Home}')
  await expect
    .element(screen.getByRole('button', { name: 'Sunday, February 22nd, 2026', exact: true }))
    .toHaveFocus()
  await userEvent.keyboard('{End}')
  await expect
    .element(screen.getByRole('button', { name: 'Saturday, February 28th, 2026', exact: true }))
    .toHaveFocus()
  expect(changed).not.toHaveBeenCalled()
})

it('localizes full dates and reverses horizontal calendar navigation in RTL', async () => {
  const screen = await render(
    <DirectionProvider direction="rtl">
      <DatePicker locale={arTN} defaultValue="2025-01-15">
        <DatePickerLabel className="sr-only">Date</DatePickerLabel>
        <Parts />
      </DatePicker>
    </DirectionProvider>,
  )
  await screen.getByRole('button', { name: /^Date / }).click()
  await expect
    .element(screen.getByRole('dialog', { name: 'Date', exact: true }))
    .toHaveAttribute('dir', 'rtl')
  await userEvent.keyboard('{ArrowLeft}')
  const nextLabel = 'الخميس، 16 جانفي 2025'
  await expect.element(screen.getByRole('button', { name: nextLabel, exact: true })).toHaveFocus()
})

it('focuses the first invalid picker inside a native fieldset', async () => {
  const screen = await render(
    <form>
      <fieldset>
        <legend>Trip</legend>
        <DatePicker required>
          <DatePickerLabel className="sr-only">Departure</DatePickerLabel>
          <Parts />
        </DatePicker>
        <DatePicker required>
          <DatePickerLabel className="sr-only">Return</DatePickerLabel>
          <Parts />
        </DatePicker>
      </fieldset>
      <button type="submit">Submit trip</button>
    </form>,
  )
  await screen.getByRole('button', { name: 'Submit trip' }).click()
  await expect.element(screen.getByRole('button', { name: 'Departure', exact: true })).toHaveFocus()
})

it('lets a picker override inherited direction independently of its formatting locale', async () => {
  const screen = await render(
    <DirectionProvider direction="rtl">
      <DatePicker direction="ltr" locale={arTN} defaultValue="2025-01-15">
        <DatePickerLabel className="sr-only">Date</DatePickerLabel>
        <Parts />
      </DatePicker>
    </DirectionProvider>,
  )
  const trigger = screen.getByRole('button', { name: /^Date / })
  await expect.element(trigger).toHaveAttribute('dir', 'ltr')
  await trigger.click()
  await expect
    .element(screen.getByRole('dialog', { name: 'Date', exact: true }))
    .toHaveAttribute('dir', 'ltr')
  await userEvent.keyboard('{ArrowRight}')
  const nextLabel = 'الخميس، 16 جانفي 2025'
  await expect.element(screen.getByRole('button', { name: nextLabel, exact: true })).toHaveFocus()
})

it('keeps Persian month labels in the Gregorian calendar used by the value', async () => {
  const changed = vi.fn()
  const screen = await render(
    <DatePicker locale={faIR} defaultValue="2025-01-15" onValueChange={changed}>
      <DatePickerLabel className="sr-only">Date</DatePickerLabel>
      <Parts />
    </DatePicker>,
  )
  await screen.getByRole('button', { name: /^Date / }).click()
  await screen.getByRole('button', { name: /Choose month and year/ }).click()
  await expect
    .element(screen.getByRole('option', { name: 'ژانویه' }))
    .toHaveAttribute('aria-selected', 'true')
  await screen.getByRole('option', { name: 'فوریه' }).click()
  await screen.getByRole('button', { name: 'OK' }).click()
  const dateName = 'شنبه ۱۵ فوریه ۲۰۲۵'
  await screen.getByRole('button', { name: dateName }).click()
  expect(changed).toHaveBeenCalledExactlyOnceWith('2025-02-15')
})
