import type {
  NumberFieldControlsProps,
  NumberFieldDecrementProps,
  NumberFieldIncrementProps,
  NumberFieldInputProps,
} from '../index'
import * as React from 'react'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { Button } from '../../button'
import { Field, FieldLabel } from '../../field'
import {
  NumberField,
  NumberFieldControls,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
} from '../index'

type RenderNumberFieldOptions = {
  defaultValue?: number
  inputProps?: Partial<NumberFieldInputProps>
  controlsProps?: Partial<NumberFieldControlsProps>
  incrementProps?: Partial<NumberFieldIncrementProps>
  decrementProps?: Partial<NumberFieldDecrementProps>
}

const renderNumberField = ({
  defaultValue = 8,
  inputProps,
  controlsProps,
  incrementProps,
  decrementProps,
}: RenderNumberFieldOptions = {}) => {
  return render(
    <NumberField defaultValue={defaultValue}>
      <NumberFieldGroup data-testid="group">
        <NumberFieldInput aria-label="Amount" {...inputProps} />
        {(controlsProps || incrementProps || decrementProps) && (
          <NumberFieldControls data-testid="controls" {...controlsProps}>
            <NumberFieldIncrement data-testid="increment" {...incrementProps} />
            <NumberFieldDecrement data-testid="decrement" {...decrementProps} />
          </NumberFieldControls>
        )}
      </NumberFieldGroup>
    </NumberField>,
  )
}

describe('NumberField wrapper', () => {
  describe('Group and input', () => {
    it('should show the compound focus surface when keyboard users enter without Field', async () => {
      const screen = await renderNumberField()
      const group = screen.getByTestId('group')
      const input = screen.getByRole('textbox', { name: 'Amount' })
      const restingBoxShadow = getComputedStyle(group.element()).boxShadow

      await userEvent.keyboard('{Tab}')

      await expect.element(input).toHaveFocus()
      await expect
        .poll(() => getComputedStyle(group.element()).boxShadow)
        .not.toBe(restingBoxShadow)
    })

    it('should surface field invalid state on the visual group', async () => {
      const screen = await render(
        <Field name="amount" invalid>
          <FieldLabel>Amount</FieldLabel>
          <NumberField defaultValue={8}>
            <NumberFieldGroup data-testid="group">
              <NumberFieldInput />
            </NumberFieldGroup>
          </NumberField>
        </Field>,
      )

      await expect.element(screen.getByTestId('group')).toHaveAttribute('data-invalid')
      await expect
        .element(screen.getByRole('textbox', { name: 'Amount' }))
        .toHaveAttribute('aria-invalid', 'true')
    })

    it('should disable autocomplete and expose placeholder and required state', async () => {
      const screen = await renderNumberField({
        inputProps: {
          placeholder: 'Regular placeholder',
          required: true,
        },
      })

      await expect
        .element(screen.getByRole('textbox', { name: 'Amount' }))
        .toHaveAttribute('autocomplete', 'off')
      await expect
        .element(screen.getByRole('textbox', { name: 'Amount' }))
        .toHaveAttribute('autocorrect', 'off')
      await expect
        .element(screen.getByRole('textbox', { name: 'Amount' }))
        .toHaveAttribute('placeholder', 'Regular placeholder')
      await expect.element(screen.getByRole('textbox', { name: 'Amount' })).toBeRequired()
    })
  })

  describe('Control buttons', () => {
    it('should provide english fallback aria labels and default icons when labels are not provided', async () => {
      const screen = await renderNumberField({
        controlsProps: {},
      })

      await expect
        .element(screen.getByRole('button', { name: 'Increment value' }))
        .toBeInTheDocument()
      await expect
        .element(screen.getByRole('button', { name: 'Decrement value' }))
        .toBeInTheDocument()
    })

    it('should preserve explicit aria labels and custom children', async () => {
      const screen = await renderNumberField({
        controlsProps: {},
        incrementProps: {
          'aria-label': 'Increase amount',
          children: <span data-testid="custom-increment-icon">+</span>,
        },
        decrementProps: {
          'aria-label': 'Decrease amount',
          children: <span data-testid="custom-decrement-icon">-</span>,
        },
      })

      expect(screen.getByRole('button', { name: 'Increase amount' }).element()).toContainElement(
        screen.getByTestId('custom-increment-icon').element(),
      )
      expect(screen.getByRole('button', { name: 'Decrease amount' }).element()).toContainElement(
        screen.getByTestId('custom-decrement-icon').element(),
      )
    })

    it('should keep the fallback aria labels when aria-label is omitted in props', async () => {
      const screen = await renderNumberField({
        controlsProps: {},
        incrementProps: {
          'aria-label': undefined,
        },
        decrementProps: {
          'aria-label': undefined,
        },
      })

      await expect
        .element(screen.getByRole('button', { name: 'Increment value' }))
        .toBeInTheDocument()
      await expect
        .element(screen.getByRole('button', { name: 'Decrement value' }))
        .toBeInTheDocument()
    })

    it('should rely on aria-labelledby when provided instead of injecting a fallback aria-label', async () => {
      const screen = await render(
        <React.Fragment>
          <span id="increment-label">Increment from label</span>
          <span id="decrement-label">Decrement from label</span>
          <NumberField defaultValue={8}>
            <NumberFieldGroup size="medium">
              <NumberFieldInput aria-label="Amount" size="medium" />
              <NumberFieldControls>
                <NumberFieldIncrement aria-labelledby="increment-label" size="medium" />
                <NumberFieldDecrement aria-labelledby="decrement-label" size="medium" />
              </NumberFieldControls>
            </NumberFieldGroup>
          </NumberField>
        </React.Fragment>,
      )

      await expect
        .element(screen.getByRole('button', { name: 'Increment from label' }))
        .not.toHaveAttribute('aria-label')
      await expect
        .element(screen.getByRole('button', { name: 'Decrement from label' }))
        .not.toHaveAttribute('aria-label')
    })
  })
})

describe('Invalid focus colors', () => {
  it.each(['light', 'dark'])(
    'preserves error colors through keyboard and pointer focus in %s',
    async (theme) => {
      const previousTheme = document.documentElement.dataset.theme
      document.documentElement.dataset.theme = theme
      try {
        const screen = await render(
          <React.Fragment>
            <Button>Before</Button>
            <Field invalid>
              <FieldLabel>Invalid value</FieldLabel>
              <NumberField defaultValue={120}>
                <NumberFieldGroup data-testid="invalid-surface">
                  <NumberFieldInput />
                </NumberFieldGroup>
              </NumberField>
            </Field>
          </React.Fragment>,
        )
        const input = screen.getByRole('textbox', { name: 'Invalid value' })
        const surface = screen.getByTestId('invalid-surface').element()
        const colors = () => {
          const style = getComputedStyle(surface)
          return [style.borderTopColor, style.backgroundColor]
        }
        const restingColors = colors()
        const restingShadow = getComputedStyle(surface).boxShadow
        await screen.getByRole('button', { name: 'Before' }).click()
        await userEvent.keyboard('{Tab}')
        await expect.element(input).toHaveFocus()
        await expect.element(input).toHaveAttribute('aria-invalid', 'true')
        await expect.poll(colors).toEqual(restingColors)
        await expect.poll(() => getComputedStyle(surface).boxShadow).not.toBe(restingShadow)
        await input.click()
        await expect.poll(colors).toEqual(restingColors)
      } finally {
        document.documentElement.dataset.theme = previousTheme
      }
    },
  )
})
