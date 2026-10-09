import * as React from 'react'
import { render } from 'vitest-browser-react'
import { Autocomplete, AutocompleteInput, AutocompleteInputGroup } from '../../autocomplete'
import { Combobox, ComboboxInput, ComboboxInputGroup } from '../../combobox'
import { DatePicker, DatePickerTrigger } from '../../date-time/date-picker'
import { DateTimePicker, DateTimePickerTrigger } from '../../date-time/date-time-picker'
import { TimePicker, TimePickerTrigger } from '../../date-time/time-picker'
import { Input } from '../../input'
import { InputGroup, InputGroupInput } from '../../input-group'
import {
  NumberField,
  NumberFieldControls,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
} from '../../number-field'
import { Select, SelectTrigger, SelectValue } from '../../select'
import { Textarea } from '../../textarea'
import { Field, FieldError } from '../index'

type ControlState = { disabled?: boolean; readOnly?: boolean }
const controlProps = { 'aria-label': 'Value' }
const surfaceProps = { 'data-testid': 'surface' }
const controls: {
  name: string
  nativePicker?: boolean
  render: (state: ControlState) => React.ReactNode
}[] = [
  { name: 'Input', render: (state) => <Input {...state} {...surfaceProps} aria-label="Value" /> },
  {
    name: 'Textarea',
    render: (state) => <Textarea {...state} {...surfaceProps} aria-label="Value" />,
  },
  {
    name: 'InputGroup',
    render: (state) => (
      <InputGroup {...surfaceProps}>
        <InputGroupInput {...state} {...controlProps} />
      </InputGroup>
    ),
  },
  {
    name: 'Combobox',
    render: (state) => (
      <Combobox {...state} items={['Value']}>
        <ComboboxInputGroup {...surfaceProps}>
          <ComboboxInput {...controlProps} />
        </ComboboxInputGroup>
      </Combobox>
    ),
  },
  {
    name: 'Autocomplete',
    render: (state) => (
      <Autocomplete {...state} items={['Value']}>
        <AutocompleteInputGroup {...surfaceProps}>
          <AutocompleteInput {...controlProps} />
        </AutocompleteInputGroup>
      </Autocomplete>
    ),
  },
  {
    name: 'NumberField',
    render: (state) => (
      <NumberField {...state}>
        <NumberFieldGroup {...surfaceProps}>
          <NumberFieldInput {...controlProps} />
          <NumberFieldControls>
            <NumberFieldIncrement />
            <NumberFieldDecrement />
          </NumberFieldControls>
        </NumberFieldGroup>
      </NumberField>
    ),
  },
  {
    name: 'Select',
    render: (state) => (
      <Select {...state}>
        <SelectTrigger {...surfaceProps} aria-label="Value">
          <SelectValue placeholder="Choose a value" />
        </SelectTrigger>
      </Select>
    ),
  },
  {
    name: 'DatePicker',
    nativePicker: true,
    render: (state) => (
      <DatePicker {...state} invalid validationMessage="Invalid value.">
        <DatePickerTrigger {...surfaceProps} aria-label="Value" />
      </DatePicker>
    ),
  },
  {
    name: 'TimePicker',
    nativePicker: true,
    render: (state) => (
      <TimePicker {...state} invalid validationMessage="Invalid value.">
        <TimePickerTrigger {...surfaceProps} aria-label="Value" />
      </TimePicker>
    ),
  },
  {
    name: 'DateTimePicker',
    nativePicker: true,
    render: (state) => (
      <DateTimePicker {...state} invalid validationMessage="Invalid value." timeZone="UTC">
        <DateTimePickerTrigger {...surfaceProps} aria-label="Value" />
      </DateTimePicker>
    ),
  },
]

function resolveColor(token: string) {
  const probe = document.createElement('span')
  probe.style.color = `var(--color-${token})`
  document.body.append(probe)
  const color = getComputedStyle(probe).color
  probe.remove()
  return color
}

for (const theme of ['light', 'dark']) {
  describe(`${theme} form control validation styles`, () => {
    beforeEach(() => {
      document.documentElement.dataset.theme = theme
    })
    afterEach(() => {
      document.documentElement.dataset.theme = 'light'
    })

    it('keeps inherited native disabled controls neutral even when the field is invalid', async () => {
      const screen = await render(
        <fieldset disabled>
          <Field invalid>
            <Input aria-label="Input" />
          </Field>
          <Field invalid>
            <Textarea aria-label="Textarea" />
          </Field>
          <Field invalid>
            <InputGroup data-testid="group">
              <InputGroupInput aria-label="Group input" />
            </InputGroup>
          </Field>
        </fieldset>,
      )
      const backgroundColor = resolveColor('components-input-bg-disabled')
      for (const name of ['Input', 'Textarea', 'Group input']) {
        await expect.element(screen.getByLabelText(name)).toBeDisabled()
      }
      for (const surface of [
        screen.getByLabelText('Input'),
        screen.getByLabelText('Textarea'),
        screen.getByTestId('group'),
      ]) {
        await expect
          .element(surface)
          .toHaveStyle({ borderTopColor: 'rgba(0, 0, 0, 0)', backgroundColor })
      }
    })

    it.each(controls)(
      '$name preserves errors while enabled and gives disabled appearance precedence',
      async ({ name, render: renderControl, nativePicker }) => {
        const fixture = (state: ControlState) =>
          nativePicker ? (
            renderControl(state)
          ) : (
            <Field invalid>
              {renderControl(state)}
              <FieldError match>Invalid value.</FieldError>
            </Field>
          )
        const screen = await render(fixture({}))
        const surface = screen.getByTestId('surface')
        const errorBorder = resolveColor('components-input-border-destructive')
        const errorBackground = resolveColor('components-input-bg-destructive')
        const disabledBackground = resolveColor('components-input-bg-disabled')
        for (const readOnly of [false, true]) {
          await screen.rerender(fixture({ readOnly }))
          await expect
            .element(surface)
            .toHaveStyle({ borderTopColor: errorBorder, backgroundColor: errorBackground })
          screen.getByLabelText('Value').element().focus()
          await expect.element(screen.getByLabelText('Value')).toHaveFocus()
          await expect
            .element(surface)
            .toHaveStyle({ borderTopColor: errorBorder, backgroundColor: errorBackground })
          await surface.hover()
          await expect
            .element(surface)
            .toHaveStyle({ borderTopColor: errorBorder, backgroundColor: errorBackground })
          await screen.rerender(fixture({ disabled: true, readOnly }))
          await expect.element(surface).toHaveStyle({
            borderTopColor: 'rgba(0, 0, 0, 0)',
            backgroundColor: disabledBackground,
          })
          await surface.hover({ force: true })
          await expect.element(surface).toHaveStyle({
            borderTopColor: 'rgba(0, 0, 0, 0)',
            backgroundColor: disabledBackground,
          })
          await expect.element(screen.getByLabelText('Value')).toBeDisabled()
          await expect
            .element(screen.getByLabelText('Value'))
            .toHaveStyle({ cursor: 'not-allowed' })
          if (name === 'NumberField') {
            await expect
              .element(screen.getByRole('button', { name: 'Increment value' }))
              .toHaveStyle({ cursor: 'not-allowed' })
            await expect
              .element(screen.getByRole('button', { name: 'Decrement value' }))
              .toHaveStyle({ cursor: 'not-allowed' })
          }
          await expect.element(screen.getByText('Invalid value.')).toBeVisible()
        }
      },
    )
  })
}
