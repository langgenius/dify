import type { DatePickerChangeEventDetails, DatePickerProps } from '@langgenius/dify-ui/date-picker'
import type { FormActions } from '@langgenius/dify-ui/form'
import {
  DatePicker,
  DatePickerClear,
  DatePickerContent,
  DatePickerLabel,
  DatePickerTrigger,
} from '@langgenius/dify-ui/date-picker'
import {
  DateTimePicker,
  DateTimePickerClear,
  DateTimePickerContent,
  DateTimePickerLabel,
  DateTimePickerTrigger,
} from '@langgenius/dify-ui/date-time-picker'
import { Field, FieldDescription, FieldError, FieldLabel } from '@langgenius/dify-ui/field'
import { Form } from '@langgenius/dify-ui/form'
import {
  TimePicker,
  TimePickerClear,
  TimePickerContent,
  TimePickerLabel,
  TimePickerTrigger,
} from '@langgenius/dify-ui/time-picker'
import * as React from 'react'
import * as ReactDOM from 'react-dom'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'

type ExampleProps = Pick<DatePickerProps, 'disabled' | 'readOnly' | 'required' | 'form'> & {
  empty?: boolean
  onValueChange?: (value: unknown, details: DatePickerChangeEventDetails) => void
}
const families = [
  {
    name: 'DatePicker',
    initial: '2025-01-15',
    serialized: '2025-01-15',
    next: '2025-01-16',
    render({ empty, ...props }: ExampleProps) {
      return (
        <DatePicker name="fallback" defaultValue={empty ? null : '2025-01-15'} {...props}>
          <DatePickerLabel>Departure</DatePickerLabel>
          <DatePickerTrigger />
          <DatePickerClear aria-label="Clear departure" />
          <DatePickerContent />
        </DatePicker>
      )
    },
    async choose(screen: Awaited<ReturnType<typeof render>>) {
      await screen
        .getByRole('button', { name: 'Thursday, January 16th, 2025', exact: true })
        .click()
    },
  },
  {
    name: 'TimePicker',
    initial: '13:30',
    serialized: '13:30',
    next: '14:30',
    render({ empty, ...props }: ExampleProps) {
      return (
        <TimePicker name="fallback" defaultValue={empty ? null : '13:30'} {...props}>
          <TimePickerLabel>Departure</TimePickerLabel>
          <TimePickerTrigger />
          <TimePickerClear aria-label="Clear departure" />
          <TimePickerContent />
        </TimePicker>
      )
    },
    async choose(screen: Awaited<ReturnType<typeof render>>) {
      await screen
        .getByRole('listbox', { name: 'Hour' })
        .getByRole('option', { name: '2', exact: true })
        .click()
      await screen.getByRole('button', { name: 'OK', exact: true }).click()
    },
  },
  {
    name: 'DateTimePicker',
    initial: new Date('2025-01-15T13:30:00Z'),
    serialized: '2025-01-15T13:30:00.000Z',
    next: '2025-01-16T13:30:00.000Z',
    render({ empty, ...props }: ExampleProps) {
      return (
        <DateTimePicker
          name="fallback"
          timeZone="UTC"
          defaultValue={empty ? null : new Date('2025-01-15T13:30:00Z')}
          {...props}
        >
          <DateTimePickerLabel>Departure</DateTimePickerLabel>
          <DateTimePickerTrigger />
          <DateTimePickerClear aria-label="Clear departure" />
          <DateTimePickerContent />
        </DateTimePicker>
      )
    },
    async choose(screen: Awaited<ReturnType<typeof render>>) {
      await screen
        .getByRole('button', { name: 'Thursday, January 16th, 2025', exact: true })
        .click()
      await screen.getByRole('button', { name: 'OK', exact: true }).click()
    },
  },
]

function ObservedField({ children, ...props }: React.ComponentProps<typeof Field>) {
  return (
    <Field
      {...props}
      render={(elementProps, state) => (
        <div {...elementProps}>
          <output data-testid="field-state">{JSON.stringify(state)}</output>
          {children}
        </div>
      )}
    />
  )
}
function stateOf(screen: Awaited<ReturnType<typeof render>>) {
  return JSON.parse(screen.getByTestId('field-state').element().textContent!)
}

it.each(families)(
  '$name registers its domain value for validation and serialized value for submission',
  async (family) => {
    const submitted = vi.fn()
    const validate = vi.fn(() => null)
    const screen = await render(
      <Form aria-label="Booking" onFormSubmit={submitted}>
        <ObservedField name="departure" validate={validate}>
          {family.render({})}
          <FieldDescription>Local departure time.</FieldDescription>
          <FieldError />
        </ObservedField>
        <button type="submit">Submit booking</button>
      </Form>,
    )
    const trigger = screen.getByRole('button', { name: /^Departure / })
    await expect.element(trigger).toHaveAccessibleDescription('Local departure time.')
    expect(stateOf(screen)).toMatchObject({ filled: true, dirty: false, touched: false })
    await screen.getByRole('button', { name: 'Submit booking' }).click()
    expect(validate).toHaveBeenCalledWith(family.initial, { departure: family.serialized })
    expect(submitted).toHaveBeenCalledExactlyOnceWith(
      { departure: family.serialized },
      expect.anything(),
    )
    expect(
      Object.fromEntries(
        new FormData(screen.getByRole('form', { name: 'Booking' }).element() as HTMLFormElement),
      ),
    ).toEqual({ departure: family.serialized })
  },
)

it.each(families)(
  '$name participates in required validation and focuses its visible trigger',
  async (family) => {
    const submitted = vi.fn()
    const screen = await render(
      <Form onFormSubmit={submitted}>
        <Field name="departure">
          {family.render({ empty: true, required: true })}
          <FieldDescription>Choose a departure.</FieldDescription>
          <FieldError match="valueMissing">Departure is required.</FieldError>
        </Field>
        <button type="submit">Submit booking</button>
      </Form>,
    )
    const trigger = screen.getByRole('button', { name: 'Departure', exact: true })
    await expect.element(trigger).not.toHaveAttribute('aria-invalid', 'true')
    await screen.getByRole('button', { name: 'Submit booking' }).click()
    expect(submitted).not.toHaveBeenCalled()
    await expect.element(trigger).toHaveFocus()
    await expect.element(trigger).toHaveAttribute('aria-invalid', 'true')
    await expect
      .element(trigger)
      .toHaveAccessibleDescription('Required Choose a departure. Departure is required.')
  },
)

it.each(families)(
  '$name validates committed changes, leaves drafts untouched, and resets the field',
  async (family) => {
    const changed = vi.fn()
    const validate = vi.fn(() => null)
    const screen = await render(
      <Form aria-label="Booking" validationMode="onChange">
        <ObservedField name="departure" validate={validate}>
          {family.render({ onValueChange: changed })}
          <FieldError />
        </ObservedField>
        <button type="reset">Reset booking</button>
      </Form>,
    )
    await screen.getByRole('button', { name: /^Departure / }).click()
    expect(stateOf(screen)).toMatchObject({ focused: true, dirty: false, touched: false })
    const commitButton = screen
      .getByRole('button', {
        name: family.name === 'DatePicker' ? 'Thursday, January 16th, 2025' : 'OK',
        exact: true,
      })
      .element()
    await family.choose(screen)
    expect(changed).toHaveBeenCalledExactlyOnceWith(
      expect.anything(),
      expect.objectContaining({
        reason: 'item-press',
        event: expect.any(Event),
        trigger: commitButton,
      }),
    )
    expect(stateOf(screen)).toMatchObject({ dirty: true, filled: true })
    expect(validate).toHaveBeenCalled()
    expect(
      new FormData(screen.getByRole('form', { name: 'Booking' }).element() as HTMLFormElement).get(
        'departure',
      ),
    ).toBe(family.next)
    await screen.getByRole('button', { name: 'Reset booking' }).click()
    expect(changed).toHaveBeenLastCalledWith(
      family.initial,
      expect.objectContaining({ reason: 'reset', event: expect.any(Event) }),
    )
    expect(
      new FormData(screen.getByRole('form', { name: 'Booking' }).element() as HTMLFormElement).get(
        'departure',
      ),
    ).toBe(family.serialized)
    expect(stateOf(screen)).toMatchObject({ dirty: false, touched: false, filled: true })
  },
)

it.each(families)(
  '$name cancels value commits and clearing before changing field state or closing',
  async (family) => {
    const errors = { departure: 'Server rejected this value.' }
    const validate = vi.fn(() => null)
    const changed = vi.fn((_value, details: DatePickerChangeEventDetails) => details.cancel())
    const screen = await render(
      <Form aria-label="Booking" errors={errors}>
        <ObservedField name="departure" validate={validate}>
          {family.render({ onValueChange: changed })}
          <FieldError />
        </ObservedField>
      </Form>,
    )
    await screen.getByRole('button', { name: /^Departure / }).click()
    await family.choose(screen)
    await expect
      .element(screen.getByRole('dialog', { name: 'Departure', exact: true }))
      .toBeVisible()
    expect(stateOf(screen)).toMatchObject({ dirty: false })
    expect(
      new FormData(screen.getByRole('form', { name: 'Booking' }).element() as HTMLFormElement).get(
        'departure',
      ),
    ).toBe(family.serialized)
    await userEvent.keyboard('{Escape}')
    const clear = screen.getByRole('button', { name: 'Clear departure' })
    await clear.click()
    await expect.element(clear).toHaveFocus()
    expect(changed).toHaveBeenLastCalledWith(
      null,
      expect.objectContaining({ reason: 'clear-press', isCanceled: true }),
    )
    expect(stateOf(screen)).toMatchObject({ dirty: false, filled: true })
    expect(validate).not.toHaveBeenCalled()
    await expect
      .element(screen.getByText('Server rejected this value.', { exact: true }))
      .toBeVisible()
  },
)

it('uses FieldLabel in non-native mode and preserves external description and error associations', async () => {
  const errors = { departure: 'Server rejected this date.' }
  const screen = await render(
    <Form errors={errors}>
      <Field name="departure">
        <FieldLabel nativeLabel={false} render={<div />}>
          Departure
        </FieldLabel>
        <DatePicker defaultValue="2025-01-15">
          <DatePickerTrigger id="departure-date" aria-describedby="additional-help" />
          <DatePickerContent />
        </DatePicker>
        <FieldDescription>Choose a working day.</FieldDescription>
        <FieldError />
      </Field>
      <p id="additional-help">Extra information.</p>
    </Form>,
  )
  const trigger = screen.getByRole('button', { name: 'Departure Jan 15, 2025' })
  await screen.getByText('Departure', { exact: true }).click()
  await expect.element(trigger).toHaveFocus()
  await expect.element(trigger).toHaveAttribute('aria-expanded', 'false')
  await expect
    .element(trigger)
    .toHaveAccessibleDescription(
      'Extra information. Choose a working day. Server rejected this date.',
    )
})

it('unregisters disabled and reassociated inputs while retaining read-only values', async () => {
  const submitted = vi.fn()
  function Example() {
    const [disabled, setDisabled] = React.useState(false)
    const [external, setExternal] = React.useState(false)
    return (
      <React.Fragment>
        <form id="external-booking" aria-label="External booking" />
        <Form onFormSubmit={submitted}>
          <fieldset disabled={disabled}>
            <Field name="departure">
              {families[0]!.render({ form: external ? 'external-booking' : undefined })}
            </Field>
          </fieldset>
          <Field name="locked">{families[1]!.render({ readOnly: true })}</Field>
          <Field name="disabled" disabled>
            {families[2]!.render({})}
          </Field>
          <button type="button" onClick={() => setDisabled(!disabled)}>
            Toggle disabled
          </button>
          <button type="button" onClick={() => setExternal(!external)}>
            Toggle form
          </button>
          <button type="submit">Submit booking</button>
        </Form>
      </React.Fragment>
    )
  }
  const screen = await render(<Example />)
  await screen.getByRole('button', { name: 'Submit booking' }).click()
  expect(submitted).toHaveBeenLastCalledWith(
    { departure: '2025-01-15', locked: '13:30' },
    expect.anything(),
  )
  await screen.getByRole('button', { name: 'Toggle disabled' }).click()
  await screen.getByRole('button', { name: 'Submit booking' }).click()
  expect(submitted).toHaveBeenLastCalledWith({ locked: '13:30' }, expect.anything())
  await screen.getByRole('button', { name: 'Toggle disabled' }).click()
  await screen.getByRole('button', { name: 'Toggle form' }).click()
  await screen.getByRole('button', { name: 'Submit booking' }).click()
  expect(submitted).toHaveBeenLastCalledWith({ locked: '13:30' }, expect.anything())
  expect(
    new FormData(
      screen.getByRole('form', { name: 'External booking' }).element() as HTMLFormElement,
    ).get('departure'),
  ).toBe('2025-01-15')
})

it.each(['external-booking', 'missing-booking'])(
  'excludes an initially reassociated picker from contextual validation and submission (%s)',
  async (form) => {
    const submitted = vi.fn()
    const validate = vi.fn(() => 'This date is unavailable.')
    const screen = await render(
      <React.Fragment>
        <form id="external-booking" aria-label="External booking" />
        <Form onFormSubmit={submitted}>
          <Field name="departure" validate={validate}>
            {families[0]!.render({ form })}
          </Field>
          <button type="submit">Submit booking</button>
        </Form>
      </React.Fragment>,
    )
    await screen.getByRole('button', { name: 'Submit booking' }).click()
    expect(validate).not.toHaveBeenCalled()
    expect(submitted).toHaveBeenCalledExactlyOnceWith({}, expect.anything())
    expect(
      new FormData(
        screen.getByRole('form', { name: 'External booking' }).element() as HTMLFormElement,
      ).get('departure'),
    ).toBe(form === 'external-booking' ? '2025-01-15' : null)
  },
)

it.each([false, true])(
  'updates contextual registration when the explicit form owner changes its id (portal: %s)',
  async (portal) => {
    const submitted = vi.fn()
    function Example({ id }: { id: string }) {
      const field = <Field name="departure">{families[0]!.render({ form: 'booking' })}</Field>
      return (
        <Form id={id} aria-label="Booking" onFormSubmit={submitted}>
          {portal ? ReactDOM.createPortal(field, document.body) : field}
          <button type="submit">Submit booking</button>
        </Form>
      )
    }
    const screen = await render(<Example id="booking" />)
    await screen.getByRole('button', { name: 'Submit booking' }).click()
    expect(submitted).toHaveBeenLastCalledWith({ departure: '2025-01-15' }, expect.anything())
    await screen.rerender(<Example id="other" />)
    expect(
      new FormData(screen.getByRole('form', { name: 'Booking' }).element() as HTMLFormElement).has(
        'departure',
      ),
    ).toBe(false)
    await screen.getByRole('button', { name: 'Submit booking' }).click()
    expect(submitted).toHaveBeenLastCalledWith({}, expect.anything())
    await screen.rerender(<Example id="booking" />)
    await screen.getByRole('button', { name: 'Submit booking' }).click()
    expect(submitted).toHaveBeenLastCalledWith({ departure: '2025-01-15' }, expect.anything())
  },
)

it('registers and resets a portalled picker with its contextual Form', async () => {
  const submitted = vi.fn()
  const screen = await render(
    <Form onFormSubmit={submitted}>
      {ReactDOM.createPortal(
        <Field name="departure">{families[0]!.render({})}</Field>,
        document.body,
      )}
      <button type="submit">Submit booking</button>
      <button type="reset">Reset booking</button>
    </Form>,
  )
  await screen.getByRole('button', { name: 'Submit booking' }).click()
  expect(submitted).toHaveBeenCalledExactlyOnceWith({ departure: '2025-01-15' }, expect.anything())
  await screen.getByRole('button', { name: /^Departure / }).click()
  await families[0]!.choose(screen)
  await screen.getByRole('button', { name: 'Reset booking' }).click()
  await expect.element(screen.getByRole('button', { name: 'Departure Jan 15, 2025' })).toBeVisible()
  await screen.getByRole('button', { name: 'Submit booking' }).click()
  expect(submitted).toHaveBeenLastCalledWith({ departure: '2025-01-15' }, expect.anything())
})

it.each([false, true])(
  'validates after leaving an autofocused picker (strict mode: %s)',
  async (strict) => {
    const validate = vi.fn(() => 'Choose another date.')
    const example = (
      <Form validationMode="onBlur">
        <ObservedField name="departure" validate={validate}>
          <DatePicker defaultValue="2025-01-15">
            <DatePickerLabel>Departure</DatePickerLabel>
            {/* oxlint-disable-next-line jsx-a11y/no-autofocus -- Reproduces focus before Field registration completes. */}
            <DatePickerTrigger autoFocus />
          </DatePicker>
          <FieldError />
        </ObservedField>
        <button type="button">Next field</button>
      </Form>
    )
    const screen = await render(strict ? <React.StrictMode>{example}</React.StrictMode> : example)
    await expect
      .element(screen.getByRole('button', { name: 'Departure Jan 15, 2025' }))
      .toHaveFocus()
    expect(stateOf(screen)).toMatchObject({ focused: true, touched: false })
    expect(validate).not.toHaveBeenCalled()
    await userEvent.tab()
    await expect.element(screen.getByRole('button', { name: 'Next field' })).toHaveFocus()
    expect(validate).toHaveBeenCalledExactlyOnceWith('2025-01-15', { departure: '2025-01-15' })
    expect(stateOf(screen)).toMatchObject({ focused: false, touched: true })
    await expect.element(screen.getByText('Choose another date.', { exact: true })).toBeVisible()
  },
)

it('validates on leaving the complete picker, not when focus enters its portalled draft', async () => {
  const validate = vi.fn((value: unknown) => (value === '13:30' ? 'Choose another time.' : null))
  const screen = await render(
    <Form validationMode="onBlur">
      <button type="button">Next field</button>
      <ObservedField name="departure" validate={validate}>
        {families[1]!.render({})}
        <FieldError />
      </ObservedField>
    </Form>,
  )
  await screen.getByRole('button', { name: /^Departure / }).click()
  await screen
    .getByRole('listbox', { name: 'Hour' })
    .getByRole('option', { name: '2', exact: true })
    .click()
  expect(validate).not.toHaveBeenCalled()
  expect(stateOf(screen)).toMatchObject({ dirty: false, touched: false, focused: true })
  await screen.getByRole('button', { name: 'Next field' }).click()
  expect(validate).toHaveBeenCalledExactlyOnceWith('13:30', { departure: '13:30' })
  await expect.element(screen.getByText('Choose another time.', { exact: true })).toBeVisible()
  const trigger = screen.getByRole('button', { name: /^Departure / })
  await expect.element(trigger).toHaveAttribute('data-invalid')
  expect(stateOf(screen)).toMatchObject({ touched: true, focused: false, dirty: false })
})

it('keeps server errors when a controlled owner rejects a change and clears them after an accepted change', async () => {
  const errors = { departure: 'Server rejected this date.' }
  function Example() {
    const [value, setValue] = React.useState<string | null>('2025-01-15')
    const [accept, setAccept] = React.useState(false)
    return (
      <Form errors={errors}>
        <ObservedField name="departure">
          <DatePicker
            value={value}
            onValueChange={(next) => {
              if (accept) setValue(next)
            }}
          >
            <DatePickerLabel>Departure</DatePickerLabel>
            <DatePickerTrigger />
            <DatePickerContent />
          </DatePicker>
          <FieldError />
        </ObservedField>
        <button type="button" onClick={() => setAccept(true)}>
          Accept changes
        </button>
      </Form>
    )
  }
  const screen = await render(<Example />)
  await screen.getByRole('button', { name: /^Departure / }).click()
  await families[0]!.choose(screen)
  await expect
    .element(screen.getByText('Server rejected this date.', { exact: true }))
    .toBeVisible()
  expect(stateOf(screen)).toMatchObject({ dirty: false })
  await screen.getByRole('button', { name: 'Accept changes' }).click()
  await screen.getByRole('button', { name: /^Departure / }).click()
  await families[0]!.choose(screen)
  await expect
    .element(screen.getByText('Server rejected this date.', { exact: true }))
    .not.toBeInTheDocument()
  expect(stateOf(screen)).toMatchObject({ dirty: true })
})

it('preserves the current value and dirty state when reset is canceled by the picker or form', async () => {
  const changed = vi.fn((_value, details: DatePickerChangeEventDetails) => {
    if (details.reason === 'reset') details.cancel()
  })
  function Example() {
    const [preventReset, setPreventReset] = React.useState(false)
    return (
      <Form
        aria-label="Booking"
        onReset={(event) => {
          if (preventReset) event.preventDefault()
        }}
      >
        <ObservedField name="departure">
          {families[0]!.render({ onValueChange: changed })}
        </ObservedField>
        <button type="reset">Reset booking</button>
        <button type="button" onClick={() => setPreventReset(true)}>
          Cancel form reset
        </button>
      </Form>
    )
  }
  const screen = await render(<Example />)
  await screen.getByRole('button', { name: /^Departure / }).click()
  await families[0]!.choose(screen)
  await screen.getByRole('button', { name: 'Reset booking' }).click()
  expect(changed).toHaveBeenLastCalledWith(
    '2025-01-15',
    expect.objectContaining({ reason: 'reset', isCanceled: true }),
  )
  expect(stateOf(screen)).toMatchObject({ dirty: true })
  expect(
    new FormData(screen.getByRole('form', { name: 'Booking' }).element() as HTMLFormElement).get(
      'departure',
    ),
  ).toBe('2025-01-16')
  await screen.getByRole('button', { name: 'Cancel form reset' }).click()
  changed.mockClear()
  await screen.getByRole('button', { name: 'Reset booking' }).click()
  expect(changed).not.toHaveBeenCalled()
  expect(stateOf(screen)).toMatchObject({ dirty: true })
})

it('revalidates a required field after a committed selection', async () => {
  const submitted = vi.fn()
  const screen = await render(
    <Form onFormSubmit={submitted}>
      <Field name="departure">
        <DatePicker required defaultValue="2025-01-15">
          <DatePickerLabel>Departure</DatePickerLabel>
          <DatePickerTrigger />
          <DatePickerClear aria-label="Clear departure" />
          <DatePickerContent />
        </DatePicker>
        <FieldError match="valueMissing">Departure is required.</FieldError>
      </Field>
      <button type="submit">Submit booking</button>
    </Form>,
  )
  await screen.getByRole('button', { name: 'Clear departure' }).click()
  await screen.getByRole('button', { name: 'Submit booking' }).click()
  await expect.element(screen.getByText('Departure is required.', { exact: true })).toBeVisible()
  expect(submitted).not.toHaveBeenCalled()
  await screen.getByRole('button', { name: 'Departure', exact: true }).click()
  await userEvent.keyboard('{Enter}')
  await expect
    .element(screen.getByText('Departure is required.', { exact: true }))
    .not.toBeInTheDocument()
  await screen.getByRole('button', { name: 'Submit booking' }).click()
  expect(submitted).toHaveBeenCalledExactlyOnceWith(
    { departure: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) },
    expect.anything(),
  )
})

it('compares DateTimePicker dirty state by instant instead of Date object identity', async () => {
  function Example() {
    const [value, setValue] = React.useState<Date | null>(() => new Date('2025-01-15T13:30:00Z'))
    return (
      <ObservedField name="departure">
        <DateTimePicker timeZone="UTC" value={value} onValueChange={setValue}>
          <DateTimePickerLabel>Departure</DateTimePickerLabel>
          <DateTimePickerTrigger />
          <DateTimePickerContent />
        </DateTimePicker>
        <button type="button" onClick={() => setValue(new Date('2025-01-15T13:30:00Z'))}>
          Restore instant
        </button>
      </ObservedField>
    )
  }
  const screen = await render(<Example />)
  await screen.getByRole('button', { name: /^Departure / }).click()
  await families[2]!.choose(screen)
  expect(stateOf(screen)).toMatchObject({ dirty: true })
  await screen.getByRole('button', { name: 'Restore instant' }).click()
  expect(stateOf(screen)).toMatchObject({ dirty: false })
})

it('keeps dirty tied to the committed controlled value when its owner declines reset', async () => {
  function Example() {
    const [value, setValue] = React.useState<string | null>('2025-01-15')
    return (
      <Form aria-label="Booking">
        <ObservedField name="departure">
          <DatePicker
            value={value}
            defaultValue="2025-01-15"
            onValueChange={(next, details) => {
              if (details.reason !== 'reset') setValue(next)
            }}
          >
            <DatePickerLabel>Departure</DatePickerLabel>
            <DatePickerTrigger />
            <DatePickerContent />
          </DatePicker>
        </ObservedField>
        <button type="reset">Reset booking</button>
      </Form>
    )
  }
  const screen = await render(<Example />)
  await screen.getByRole('button', { name: /^Departure / }).click()
  await families[0]!.choose(screen)
  await screen.getByRole('button', { name: 'Reset booking' }).click()
  await expect.element(screen.getByRole('button', { name: 'Departure Jan 16, 2025' })).toBeVisible()
  expect(stateOf(screen)).toMatchObject({ dirty: true, touched: false })
  expect(
    new FormData(screen.getByRole('form', { name: 'Booking' }).element() as HTMLFormElement).get(
      'departure',
    ),
  ).toBe('2025-01-16')
})

it('clears reset feedback without removing required validation on the next submit', async () => {
  const submitted = vi.fn()
  const screen = await render(
    <Form onFormSubmit={submitted}>
      <ObservedField name="departure">
        {families[0]!.render({ empty: true, required: true })}
        <FieldError match="valueMissing">Departure is required.</FieldError>
      </ObservedField>
      <button type="submit">Submit booking</button>
      <button type="reset">Reset booking</button>
    </Form>,
  )
  await screen.getByRole('button', { name: 'Submit booking' }).click()
  await expect.element(screen.getByText('Departure is required.', { exact: true })).toBeVisible()
  await screen.getByRole('button', { name: 'Reset booking' }).click()
  await expect
    .element(screen.getByText('Departure is required.', { exact: true }))
    .not.toBeInTheDocument()
  expect(stateOf(screen)).toMatchObject({ touched: false, dirty: false })
  await screen.getByRole('button', { name: 'Submit booking' }).click()
  expect(submitted).not.toHaveBeenCalled()
  await expect.element(screen.getByText('Departure is required.', { exact: true })).toBeVisible()
  await expect.element(screen.getByRole('button', { name: 'Departure', exact: true })).toHaveFocus()
})

it('clears Field custom validity on reset and validates the restored value on the next submit', async () => {
  const submitted = vi.fn()
  const screen = await render(
    <Form aria-label="Booking" validationMode="onChange" onFormSubmit={submitted}>
      <ObservedField
        name="departure"
        validate={(value) => (value === '2025-01-16' ? 'Date unavailable.' : null)}
      >
        {families[0]!.render({})}
        <FieldError />
      </ObservedField>
      <button type="submit">Submit booking</button>
      <button type="reset">Reset booking</button>
    </Form>,
  )
  await screen.getByRole('button', { name: /^Departure / }).click()
  await families[0]!.choose(screen)
  await expect.element(screen.getByText('Date unavailable.', { exact: true })).toBeVisible()
  await screen.getByRole('button', { name: 'Reset booking' }).click()
  await expect
    .element(screen.getByText('Date unavailable.', { exact: true }))
    .not.toBeInTheDocument()
  expect(
    (screen.getByRole('form', { name: 'Booking' }).element() as HTMLFormElement).checkValidity(),
  ).toBe(true)
  await screen.getByRole('button', { name: 'Submit booking' }).click()
  expect(submitted).toHaveBeenCalledExactlyOnceWith({ departure: '2025-01-15' }, expect.anything())
})

it('integrates native invalid events with Field without marking an unchanged value dirty', async () => {
  const submitted = vi.fn((event: React.FormEvent) => event.preventDefault())
  const screen = await render(
    <form onSubmit={submitted}>
      <ObservedField name="departure">
        {families[0]!.render({ empty: true, required: true })}
        <FieldError match="valueMissing">Departure is required.</FieldError>
      </ObservedField>
      <button type="submit">Submit booking</button>
    </form>,
  )
  await screen.getByRole('button', { name: 'Submit booking' }).click()
  expect(submitted).not.toHaveBeenCalled()
  await expect.element(screen.getByText('Departure is required.', { exact: true })).toBeVisible()
  expect(stateOf(screen)).toMatchObject({ touched: true, dirty: false, valid: false })
  await expect.element(screen.getByRole('button', { name: 'Departure', exact: true })).toHaveFocus()
})

it('ignores a pending validation result after reset', async () => {
  let finishValidation: ((message: string) => void) | undefined
  const screen = await render(
    <Form validationMode="onChange">
      <ObservedField
        name="departure"
        validate={() =>
          new Promise<string>((resolve) => {
            finishValidation = resolve
          })
        }
      >
        {families[0]!.render({})}
        <FieldError />
      </ObservedField>
      <button type="reset">Reset booking</button>
    </Form>,
  )
  await screen.getByRole('button', { name: /^Departure / }).click()
  await families[0]!.choose(screen)
  expect(finishValidation).toBeTypeOf('function')
  await screen.getByRole('button', { name: 'Reset booking' }).click()
  await expect.element(screen.getByRole('button', { name: 'Departure Jan 15, 2025' })).toBeVisible()
  await React.act(async () => {
    finishValidation!('Stale validation error.')
  })
  await expect
    .element(screen.getByText('Stale validation error.', { exact: true }))
    .not.toBeInTheDocument()
  expect(stateOf(screen)).toMatchObject({ dirty: false, touched: false, valid: null })
})

it.each(['disabled', 'fieldset-disabled', 'unmounted'] as const)(
  'releases Field focus when its focused picker becomes %s without a blur event',
  async (transition) => {
    function Example({ changed = false }: { changed?: boolean }) {
      return (
        <fieldset disabled={changed && transition === 'fieldset-disabled'}>
          <ObservedField name="departure">
            {!(changed && transition === 'unmounted') &&
              families[0]!.render({ disabled: changed && transition === 'disabled' })}
          </ObservedField>
        </fieldset>
      )
    }
    const screen = await render(<Example />)
    await screen.getByText('Departure', { exact: true }).click()
    await expect.element(screen.getByRole('button', { name: /^Departure / })).toHaveFocus()
    expect(stateOf(screen)).toMatchObject({ focused: true })
    await screen.rerender(<Example changed />)
    expect(stateOf(screen)).toMatchObject({ focused: false, touched: false })
  },
)

it('replaces name and id registrations and removes unmounted pickers in Strict Mode', async () => {
  const submitted = vi.fn()
  const validate = vi.fn(() => null)
  function Example({ name, mounted = true }: { name: string; mounted?: boolean }) {
    const actionsRef = React.useRef<FormActions>(null)
    return (
      <Form actionsRef={actionsRef} onFormSubmit={submitted}>
        <Field name={name} validate={validate}>
          {mounted && (
            <DatePicker defaultValue="2025-01-15">
              <DatePickerLabel>Departure</DatePickerLabel>
              <DatePickerTrigger id={`${name}-trigger`} />
              <DatePickerContent />
            </DatePicker>
          )}
        </Field>
        <button type="button" onClick={() => actionsRef.current?.validate('previous')}>
          Validate previous
        </button>
        <button type="button" onClick={() => actionsRef.current?.validate('current')}>
          Validate current
        </button>
        <button type="submit">Submit booking</button>
      </Form>
    )
  }
  const view = (name: string, mounted = true) => (
    <React.StrictMode>
      <Example name={name} mounted={mounted} />
    </React.StrictMode>
  )
  const screen = await render(view('previous'))
  await screen.rerender(view('current'))
  await screen.getByText('Departure', { exact: true }).click()
  const trigger = screen.getByRole('button', { name: 'Departure Jan 15, 2025' })
  await expect.element(trigger).toHaveFocus()
  await expect.element(trigger).toHaveAttribute('id', 'current-trigger')
  await expect.element(trigger).toHaveAttribute('aria-expanded', 'false')
  await screen.getByRole('button', { name: 'Validate previous' }).click()
  expect(validate).not.toHaveBeenCalled()
  await screen.getByRole('button', { name: 'Validate current' }).click()
  expect(validate).toHaveBeenCalledExactlyOnceWith('2025-01-15', { current: '2025-01-15' })
  await screen.getByRole('button', { name: 'Submit booking' }).click()
  expect(submitted).toHaveBeenLastCalledWith({ current: '2025-01-15' }, expect.anything())
  await screen.rerender(view('current', false))
  validate.mockClear()
  await screen.getByRole('button', { name: 'Validate current' }).click()
  await screen.getByRole('button', { name: 'Submit booking' }).click()
  expect(validate).not.toHaveBeenCalled()
  expect(submitted).toHaveBeenLastCalledWith({}, expect.anything())
  await screen.rerender(view('current'))
  await screen.getByRole('button', { name: 'Submit booking' }).click()
  expect(validate).toHaveBeenCalledExactlyOnceWith('2025-01-15', { current: '2025-01-15' })
  expect(submitted).toHaveBeenLastCalledWith({ current: '2025-01-15' }, expect.anything())
})

it('keeps Clear inside the field focus boundary while dismissing an open popup', async () => {
  const validate = vi.fn(() => null)
  const screen = await render(
    <Form validationMode="onBlur">
      <ObservedField name="departure" validate={validate}>
        <div style={{ display: 'flex', gap: 4 }}>{families[0]!.render({})}</div>
      </ObservedField>
    </Form>,
  )
  await screen.getByRole('button', { name: /^Departure / }).click()
  await screen.getByRole('button', { name: 'Clear departure' }).click()
  await expect.element(screen.getByRole('button', { name: 'Departure', exact: true })).toHaveFocus()
  expect(validate).not.toHaveBeenCalled()
  expect(stateOf(screen)).toMatchObject({ touched: false, focused: true, filled: false })
})

it('preserves Field native custom validity when only picker validation copy changes', async () => {
  const submitted = vi.fn((event: React.FormEvent) => event.preventDefault())
  function Example({ message }: { message: string }) {
    return (
      <form onSubmit={submitted}>
        <button type="button">Next field</button>
        <Field name="departure" validationMode="onBlur" validate={() => 'Date unavailable.'}>
          <DatePicker defaultValue="2025-01-15" validationMessage={message}>
            <DatePickerLabel>Departure</DatePickerLabel>
            <DatePickerTrigger />
            <DatePickerContent />
          </DatePicker>
          <FieldError />
        </Field>
        <button type="submit">Submit booking</button>
      </form>
    )
  }
  const screen = await render(<Example message="Choose a date." />)
  await screen.getByText('Departure', { exact: true }).click()
  await screen.getByRole('button', { name: 'Next field' }).click()
  await expect.element(screen.getByText('Date unavailable.', { exact: true })).toBeVisible()
  await screen.rerender(<Example message="请选择日期。" />)
  await screen.getByRole('button', { name: 'Submit booking' }).click()
  expect(submitted).not.toHaveBeenCalled()
  await expect.element(screen.getByRole('button', { name: /^Departure / })).toHaveFocus()
})

it.each(['disabled', 'unmounted'] as const)(
  'releases focus when only the Trigger becomes %s',
  async (transition) => {
    function Example({ changed = false }: { changed?: boolean }) {
      return (
        <ObservedField name="departure">
          <DatePicker defaultValue="2025-01-15">
            <DatePickerLabel>Departure</DatePickerLabel>
            {!(changed && transition === 'unmounted') && <DatePickerTrigger disabled={changed} />}
            <DatePickerContent />
          </DatePicker>
        </ObservedField>
      )
    }
    const screen = await render(<Example />)
    await screen.getByText('Departure', { exact: true }).click()
    expect(stateOf(screen)).toMatchObject({ focused: true })
    await screen.rerender(<Example changed />)
    expect(stateOf(screen)).toMatchObject({ focused: false })
  },
)

it('releases focus when an external controlled update unmounts the focused Clear', async () => {
  function Example({ value }: { value: string | null }) {
    return (
      <ObservedField name="departure">
        <DatePicker value={value}>
          <DatePickerLabel>Departure</DatePickerLabel>
          <DatePickerTrigger />
          <DatePickerClear aria-label="Clear departure" />
          <DatePickerContent />
        </DatePicker>
      </ObservedField>
    )
  }
  const screen = await render(<Example value="2025-01-15" />)
  await screen.getByText('Departure', { exact: true }).click()
  await userEvent.tab()
  await expect.element(screen.getByRole('button', { name: 'Clear departure' })).toHaveFocus()
  expect(stateOf(screen)).toMatchObject({ focused: true })
  await screen.rerender(<Example value={null} />)
  expect(stateOf(screen)).toMatchObject({ focused: false })
})

it('preserves Field focus when a consumer replaces its Trigger callback ref', async () => {
  function Example({ label }: { label: string }) {
    return (
      <ObservedField name="departure">
        <DatePicker defaultValue="2025-01-15">
          <DatePickerLabel>{label}</DatePickerLabel>
          <DatePickerTrigger ref={() => {}} />
        </DatePicker>
      </ObservedField>
    )
  }
  const screen = await render(<Example label="Departure" />)
  await screen.getByText('Departure', { exact: true }).click()
  await screen.rerender(<Example label="Travel date" />)
  await expect.element(screen.getByRole('button', { name: /^Travel date / })).toHaveFocus()
  expect(stateOf(screen)).toMatchObject({ focused: true, touched: false })
})

it.each(['PickerLabel', 'FieldLabel'] as const)(
  'keeps %s text inside the focus boundary when dismissing an open popup',
  async (label) => {
    const validate = vi.fn(() => null)
    const screen = await render(
      <Form validationMode="onBlur">
        <ObservedField name="departure" validate={validate}>
          {label === 'FieldLabel' && (
            <FieldLabel nativeLabel={false} render={<div />}>
              Departure
            </FieldLabel>
          )}
          <DatePicker defaultValue="2025-01-15">
            {label === 'PickerLabel' && <DatePickerLabel>Departure</DatePickerLabel>}
            <DatePickerTrigger />
            <DatePickerContent />
          </DatePicker>
        </ObservedField>
      </Form>,
    )
    await screen.getByRole('button', { name: /^Departure / }).click()
    await screen.getByText('Departure', { exact: true }).click()
    await expect.element(screen.getByRole('button', { name: /^Departure / })).toHaveFocus()
    expect(validate).not.toHaveBeenCalled()
    expect(stateOf(screen)).toMatchObject({ focused: true, touched: false })
  },
)

it.each([false, true])(
  'restores only current Field validity after removing a picker constraint (reset: %s)',
  async (reset) => {
    const submitted = vi.fn((event: React.FormEvent) => event.preventDefault())
    function Example({ minDate }: { minDate: string }) {
      return (
        <form onSubmit={submitted}>
          <button type="button">Next field</button>
          <Field name="departure" validationMode="onBlur" validate={() => 'Date unavailable.'}>
            <DatePicker defaultValue="2025-01-15" minDate={minDate}>
              <DatePickerLabel>Departure</DatePickerLabel>
              <DatePickerTrigger />
            </DatePicker>
            <FieldError />
          </Field>
          <button type="reset">Reset booking</button>
          <button type="submit">Submit booking</button>
        </form>
      )
    }
    const screen = await render(<Example minDate="2025-01-01" />)
    await screen.getByText('Departure', { exact: true }).click()
    await screen.getByRole('button', { name: 'Next field' }).click()
    await expect.element(screen.getByText('Date unavailable.', { exact: true })).toBeVisible()
    await screen.rerender(<Example minDate="2025-01-16" />)
    if (reset) {
      await screen.getByRole('button', { name: 'Reset booking' }).click()
      await expect
        .element(screen.getByText('Date unavailable.', { exact: true }))
        .not.toBeInTheDocument()
    }
    await screen.rerender(<Example minDate="2025-01-01" />)
    await screen.getByRole('button', { name: 'Submit booking' }).click()
    if (reset) expect(submitted).toHaveBeenCalledOnce()
    else expect(submitted).not.toHaveBeenCalled()
  },
)

it.each(['enabled', 'disabled', 'readOnly'] as const)(
  'does not restore obsolete picker validity after Field replaces it (%s)',
  async (state) => {
    const validate = vi.fn((): string | null => 'Field rejected the date.')
    const submitted = vi.fn()
    function Example({ minDate, barred = false }: { minDate: string; barred?: boolean }) {
      const actionsRef = React.useRef<FormActions>(null)
      return (
        <Form validationMode="onChange" actionsRef={actionsRef} onFormSubmit={submitted}>
          <Field name="departure" validate={validate}>
            <DatePicker
              defaultValue="2025-01-15"
              minDate={minDate}
              disabled={barred && state === 'disabled'}
              readOnly={barred && state === 'readOnly'}
            >
              <DatePickerLabel>Departure</DatePickerLabel>
              <DatePickerTrigger />
            </DatePicker>
            <FieldError />
          </Field>
          <button type="button" onClick={() => actionsRef.current?.validate()}>
            Validate booking
          </button>
          <button type="submit">Submit booking</button>
        </Form>
      )
    }
    const screen = await render(<Example minDate="2025-01-16" />)
    await screen.getByRole('button', { name: 'Validate booking' }).click()
    await expect
      .element(screen.getByText('Field rejected the date.', { exact: true }))
      .toBeVisible()
    validate.mockReturnValue(null)
    await screen.rerender(<Example minDate="2025-01-01" barred />)
    await screen.rerender(<Example minDate="2025-01-01" />)
    await screen.getByRole('button', { name: 'Validate booking' }).click()
    await screen.getByRole('button', { name: 'Submit booking' }).click()
    expect(submitted).toHaveBeenCalledExactlyOnceWith(
      { departure: '2025-01-15' },
      expect.anything(),
    )
  },
)
