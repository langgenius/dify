import { Button } from '@langgenius/dify-ui/button'
import { Field, FieldDescription, FieldError, FieldLabel } from '@langgenius/dify-ui/field'
import { Fieldset, FieldsetLegend } from '@langgenius/dify-ui/fieldset'
import { Form } from '@langgenius/dify-ui/form'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { IconPicker, IconPickerContent, IconPickerIcon, IconPickerTrigger } from '..'
import { emojiCatalogOptions } from '../emoji-data'

vi.mock('@/service/console', () => ({
  consoleQuery: {
    files: { upload: { post: { mutationOptions: () => ({ mutationFn: vi.fn() }) } } },
  },
}))

it('keeps field feedback on the trigger while editing and clears it only after confirmation', async () => {
  const client = new QueryClient()
  client.setQueryData(emojiCatalogOptions.queryKey, [
    { id: 'faces', label: 'Faces', items: [{ emoji: '😀', label: 'Smiling face', version: 1 }] },
  ])
  const submit = vi.fn()
  await render(
    <QueryClientProvider client={client}>
      <Form aria-label="Agent" onFormSubmit={submit}>
        <Field name="icon">
          <FieldLabel nativeLabel={false} render={<span />}>
            Agent icon
          </FieldLabel>
          <FieldDescription>Choose an emoji or image.</FieldDescription>
          <IconPicker required>
            <IconPickerTrigger>
              <IconPickerIcon />
            </IconPickerTrigger>
            <IconPickerContent />
          </IconPicker>
          <FieldError match="valueMissing">Choose an icon before saving.</FieldError>
        </Field>
        <Button type="submit">Save</Button>
      </Form>
    </QueryClientProvider>,
  )
  const trigger = page.getByRole('button', { name: 'Agent icon' })
  await expect.element(trigger).not.toHaveAttribute('aria-invalid', 'true')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect.element(trigger).toHaveFocus()
  await expect.element(trigger).toHaveAttribute('aria-invalid', 'true')
  await expect
    .element(trigger)
    .toHaveAccessibleDescription('Choose an emoji or image. Choose an icon before saving.')
  expect(submit).not.toHaveBeenCalled()
  const triggerElement = trigger.element()
  const formLocator = page.getByRole('form', { name: 'Agent' })
  await expect.element(formLocator).toBeInTheDocument()
  const form = formLocator.element() as HTMLFormElement

  await trigger.click()
  const search = page.getByRole('combobox', { name: 'app.iconPicker.search' })
  await expect.element(search).not.toHaveAccessibleDescription()
  await expect.element(search).not.toHaveAttribute('name', 'icon')
  await expect.element(search).not.toHaveAttribute('aria-invalid', 'true')
  await search.fill('Smiling face')
  await page.getByRole('gridcell', { name: 'Smiling face' }).click()
  const color = page.getByRole('radio', { name: 'app.iconPicker.color.green' })
  await expect.element(color).not.toHaveAccessibleDescription()
  await expect.element(color).not.toHaveAttribute('name', 'icon')
  await expect.element(color).not.toHaveAttribute('aria-invalid', 'true')
  await color.click()

  await page.getByRole('tab', { name: 'app.iconPicker.image' }).click()
  const canvas = document.createElement('canvas')
  canvas.width = 20
  canvas.height = 20
  canvas.getContext('2d')!.fillRect(0, 0, 20, 20)
  const blob = await new Promise<Blob>((resolve) =>
    canvas.toBlob((value) => resolve(value!), 'image/png'),
  )
  await page.getByTestId('image-input').upload(new File([blob], 'icon.png', { type: 'image/png' }))
  const zoom = page.getByRole('slider', { name: 'app.iconPicker.zoom' })
  await expect.element(zoom).toBeVisible()
  await expect.element(zoom).not.toHaveAccessibleDescription()
  await expect.element(zoom).not.toHaveAttribute('name', 'icon')
  await expect.element(zoom).not.toHaveAttribute('aria-invalid', 'true')
  await expect.element(triggerElement).toHaveAttribute('aria-invalid', 'true')
  await expect
    .element(triggerElement)
    .toHaveAccessibleDescription('Choose an emoji or image. Choose an icon before saving.')
  expect(new FormData(form).get('icon')).toBe('')

  await page.getByRole('tab', { name: 'app.iconPicker.emoji' }).click()
  await page.getByRole('button', { name: 'app.iconPicker.ok' }).click()
  await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
  await expect.element(trigger).not.toHaveAttribute('aria-invalid', 'true')
  await expect.element(trigger).toHaveAccessibleDescription('Choose an emoji or image.')
  await trigger.click()
  await page.getByRole('radio', { name: 'app.iconPicker.color.rose' }).click()
  form.requestSubmit()
  await expect.poll(() => submit.mock.calls.length).toBe(1)
  expect(submit).toHaveBeenCalledExactlyOnceWith(
    { icon: { type: 'emoji', icon: '😀', background: '#F3FEE7' } },
    expect.anything(),
  )
  await userEvent.keyboard('{Escape}')
  await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
  client.clear()
})

it('routes native required-input focus to the visible picker instead of the hidden proxy', async () => {
  const submit = vi.fn()
  await render(
    <form
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <Field name="icon">
        <FieldLabel nativeLabel={false} render={<span />}>
          Agent icon
        </FieldLabel>
        <IconPicker required>
          <IconPickerTrigger>
            <IconPickerIcon />
          </IconPickerTrigger>
        </IconPicker>
        <FieldError match="valueMissing">Choose an icon before saving.</FieldError>
      </Field>
      <Button type="submit">Save</Button>
    </form>,
  )
  await page.getByRole('button', { name: 'Save' }).click()
  const trigger = page.getByRole('button', { name: 'Agent icon' })
  await expect.element(trigger).toHaveFocus()
  await expect.element(page.getByText('Choose an icon before saving.')).toBeVisible()
  await expect.element(trigger).toHaveAccessibleDescription('Choose an icon before saving.')
  expect(submit).not.toHaveBeenCalled()
})

it('excludes and restores the icon when its Fieldset is disabled and enabled', async () => {
  const icon = { type: 'emoji', icon: '😀', background: '#FEF3F2' } as const
  const submit = vi.fn()
  const content = (disabled: boolean) => (
    <Form aria-label="Agent" onFormSubmit={submit}>
      <Fieldset disabled={disabled}>
        <FieldsetLegend>Appearance</FieldsetLegend>
        <Field name="icon">
          <IconPicker defaultValue={icon}>
            <IconPickerTrigger aria-label="Agent icon">
              <IconPickerIcon />
            </IconPickerTrigger>
          </IconPicker>
        </Field>
      </Fieldset>
      <Button type="submit">Save</Button>
    </Form>
  )
  const { rerender } = await render(content(false))
  const form = page.getByRole('form', { name: 'Agent' })
  await expect.element(form).toBeInTheDocument()
  const nativeValues = () => new FormData(form.element() as HTMLFormElement)
  await page.getByRole('button', { name: 'Save' }).click()
  expect(submit).toHaveBeenLastCalledWith({ icon }, expect.anything())
  expect(nativeValues().get('icon')).toBe(JSON.stringify(icon))

  await rerender(content(true))
  await expect.element(page.getByRole('button', { name: 'Agent icon' })).toBeDisabled()
  await page.getByRole('button', { name: 'Save' }).click()
  expect(submit).toHaveBeenLastCalledWith({}, expect.anything())
  expect(nativeValues().has('icon')).toBe(false)

  await rerender(content(false))
  await page.getByRole('button', { name: 'Save' }).click()
  expect(submit).toHaveBeenLastCalledWith({ icon }, expect.anything())
  expect(nativeValues().get('icon')).toBe(JSON.stringify(icon))
})

it('tracks autofocus and blur validation when StrictMode replays effects', async () => {
  await render(
    <StrictMode>
      <Field
        name="icon"
        validationMode="onBlur"
        validate={() => 'Choose an icon.'}
        render={(props, state) => (
          <div {...props}>
            <output aria-label="Icon focus">{state.focused ? 'Focused' : 'Blurred'}</output>
            {props.children}
          </div>
        )}
      >
        <IconPicker>
          {/* oxlint-disable-next-line jsx-a11y/no-autofocus -- Reproduces mount-time focus before StrictMode replays the field effects. */}
          <IconPickerTrigger autoFocus aria-label="Agent icon" />
        </IconPicker>
        <FieldError match="customError" />
      </Field>
      <Button>Next field</Button>
    </StrictMode>,
  )
  await expect.element(page.getByRole('button', { name: 'Agent icon' })).toHaveFocus()
  await expect
    .element(page.getByRole('status', { name: 'Icon focus' }))
    .toHaveTextContent('Focused')
  await userEvent.keyboard('{Tab}')
  await expect.element(page.getByRole('button', { name: 'Next field' })).toHaveFocus()
  await expect.element(page.getByText('Choose an icon.')).toBeVisible()
})
