import type { FormProps } from '@langgenius/dify-ui/form'
import type { IconPickerInputValue, IconPickerProps } from '..'
import { Button } from '@langgenius/dify-ui/button'
import { Field, FieldDescription, FieldLabel } from '@langgenius/dify-ui/field'
import { Form } from '@langgenius/dify-ui/form'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IconPicker, IconPickerContent, IconPickerIcon, IconPickerTrigger } from '..'
import { emojiCatalogOptions } from '../emoji-data'

vi.mock('@/service/console', () => ({
  consoleQuery: {
    files: { upload: { post: { mutationOptions: () => ({ mutationFn: vi.fn() }) } } },
  },
}))

const initial = { type: 'emoji', icon: '😀', background: '#FEF3F2' } as const
const green = { ...initial, background: '#F3FEE7' }
type PickerProps = Omit<IconPickerProps, 'children'>

function renderForm(
  pickerProps: PickerProps,
  fieldDisabled = false,
  onReset?: FormProps['onReset'],
  triggerDisabled = false,
) {
  const client = new QueryClient()
  client.setQueryData(emojiCatalogOptions.queryKey, [])
  const submit = vi.fn()
  const nativeSubmit = vi.fn()
  const content = (props: PickerProps) => (
    <QueryClientProvider client={client}>
      <Form<{ icon: IconPickerInputValue | null }>
        aria-label="Agent"
        onSubmit={(event) => nativeSubmit(Object.fromEntries(new FormData(event.currentTarget)))}
        onFormSubmit={submit}
        onReset={onReset}
      >
        <Field
          name="icon"
          disabled={fieldDisabled}
          render={(props, state) => (
            <div {...props}>
              <span role="status" aria-label="Icon changes">
                {state.dirty ? 'Changed' : 'Unchanged'}
              </span>
              {props.children}
            </div>
          )}
        >
          <FieldLabel nativeLabel={false} render={<span />}>
            Agent icon
          </FieldLabel>
          <FieldDescription>Choose an emoji or image.</FieldDescription>
          <IconPicker {...props}>
            <IconPickerTrigger disabled={triggerDisabled}>
              <IconPickerIcon />
            </IconPickerTrigger>
            <IconPickerContent />
          </IconPicker>
        </Field>
        <Button type="submit">Save</Button>
        <Button type="reset">Reset</Button>
      </Form>
    </QueryClientProvider>
  )
  const view = render(content(pickerProps))
  const form = screen.getByRole<HTMLFormElement>('form', { name: 'Agent' })
  return {
    ...view,
    client,
    form,
    submit,
    nativeSubmit,
    user: userEvent.setup(),
    rerenderPicker: (props: PickerProps) => view.rerender(content(props)),
  }
}

it.each<IconPickerInputValue>([
  initial,
  { type: 'image', fileId: 'uploaded-icon', url: '/icon.png' },
  { type: 'link', url: 'https://example.com/icon.png' },
])('submits the $type icon as a Form value and serializes it only for FormData', async (icon) => {
  const { client, submit, nativeSubmit, user } = renderForm({ defaultValue: icon })
  const trigger = screen.getByRole('button', { name: 'Agent icon' })
  expect(trigger).toHaveAccessibleDescription('Choose an emoji or image.')
  await user.click(screen.getByRole('button', { name: 'Save' }))
  expect(submit).toHaveBeenCalledExactlyOnceWith({ icon }, expect.anything())
  expect(nativeSubmit).toHaveBeenCalledExactlyOnceWith({ icon: JSON.stringify(icon) })
  client.clear()
})

it('keeps drafts out of the field and resets the confirmed value to its initial icon', async () => {
  const onValueChange = vi.fn()
  let cancelReset = true
  const { client, form, submit, user } = renderForm(
    { defaultValue: initial, onValueChange },
    false,
    (event) => {
      if (cancelReset) event.preventDefault()
    },
  )
  const trigger = screen.getByRole('button', { name: 'Agent icon' })
  await user.click(trigger)
  await user.click(screen.getByRole('radio', { name: 'app.iconPicker.color.green' }))
  expect(new FormData(form).get('icon')).toBe(JSON.stringify(initial))
  await user.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(screen.getByRole('status', { name: 'Icon changes' })).toHaveTextContent('Unchanged')
  await user.click(screen.getByRole('button', { name: 'Save' }))
  expect(submit).toHaveBeenLastCalledWith({ icon: initial }, expect.anything())
  expect(onValueChange).not.toHaveBeenCalled()

  await user.click(trigger)
  await user.click(screen.getByRole('radio', { name: 'app.iconPicker.color.green' }))
  await user.click(screen.getByRole('button', { name: 'app.iconPicker.ok' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(onValueChange).toHaveBeenCalledExactlyOnceWith(green)
  expect(screen.getByRole('status', { name: 'Icon changes' })).toHaveTextContent('Changed')
  await user.click(screen.getByRole('button', { name: 'Save' }))
  expect(submit).toHaveBeenLastCalledWith({ icon: green }, expect.anything())
  expect(new FormData(form).get('icon')).toBe(JSON.stringify(green))

  await user.click(screen.getByRole('button', { name: 'Reset' }))
  await user.click(screen.getByRole('button', { name: 'Save' }))
  expect(submit).toHaveBeenLastCalledWith({ icon: green }, expect.anything())
  expect(new FormData(form).get('icon')).toBe(JSON.stringify(green))
  expect(screen.getByRole('status', { name: 'Icon changes' })).toHaveTextContent('Changed')

  cancelReset = false
  await user.click(screen.getByRole('button', { name: 'Reset' }))
  await waitFor(() => expect(new FormData(form).get('icon')).toBe(JSON.stringify(initial)))
  expect(screen.getByRole('status', { name: 'Icon changes' })).toHaveTextContent('Unchanged')
  expect(onValueChange).toHaveBeenCalledOnce()
  await user.click(screen.getByRole('button', { name: 'Save' }))
  expect(submit).toHaveBeenLastCalledWith({ icon: initial }, expect.anything())
  client.clear()
})

it('keeps null controlled through external updates, clearing, and a rejected candidate', async () => {
  const onValueChange = vi.fn()
  const { client, form, submit, user, rerenderPicker } = renderForm({ value: null, onValueChange })
  expect(new FormData(form).get('icon')).toBe('')
  expect(screen.getByRole('status', { name: 'Icon changes' })).toHaveTextContent('Unchanged')

  rerenderPicker({ value: initial, onValueChange })
  expect(new FormData(form).get('icon')).toBe(JSON.stringify(initial))
  expect(screen.getByRole('status', { name: 'Icon changes' })).toHaveTextContent('Changed')
  await user.click(screen.getByRole('button', { name: 'Save' }))
  expect(submit).toHaveBeenLastCalledWith({ icon: initial }, expect.anything())

  rerenderPicker({ value: null, onValueChange })
  expect(new FormData(form).get('icon')).toBe('')
  expect(screen.getByRole('status', { name: 'Icon changes' })).toHaveTextContent('Unchanged')
  client.setQueryData(emojiCatalogOptions.queryKey, [
    { id: 'faces', label: 'Faces', items: [{ emoji: '😀', label: 'Smiling face', version: 1 }] },
  ])
  await user.click(screen.getByRole('button', { name: 'Agent icon' }))
  await user.type(screen.getByRole('combobox', { name: 'app.iconPicker.search' }), 'Smiling face')
  await user.click(await screen.findByRole('gridcell', { name: 'Smiling face' }))
  await user.click(screen.getByRole('button', { name: 'app.iconPicker.ok' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(onValueChange).toHaveBeenCalledExactlyOnceWith(initial)
  expect(new FormData(form).get('icon')).toBe('')
  expect(screen.getByRole('status', { name: 'Icon changes' })).toHaveTextContent('Unchanged')
  await user.click(screen.getByRole('button', { name: 'Save' }))
  expect(submit).toHaveBeenLastCalledWith({ icon: null }, expect.anything())
  client.clear()
})

it('keeps the field pristine when a controlled owner rejects a confirmed candidate', async () => {
  const onValueChange = vi.fn()
  const { client, form, submit, user } = renderForm({ value: initial, onValueChange })
  await user.click(screen.getByRole('button', { name: 'Agent icon' }))
  await user.click(screen.getByRole('radio', { name: 'app.iconPicker.color.green' }))
  await user.click(screen.getByRole('button', { name: 'app.iconPicker.ok' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(onValueChange).toHaveBeenCalledExactlyOnceWith(green)
  expect(screen.getByRole('status', { name: 'Icon changes' })).toHaveTextContent('Unchanged')
  expect(new FormData(form).get('icon')).toBe(JSON.stringify(initial))
  await user.click(screen.getByRole('button', { name: 'Save' }))
  expect(submit).toHaveBeenCalledExactlyOnceWith({ icon: initial }, expect.anything())
  client.clear()
})

it.each([
  { props: { disabled: true }, fieldDisabled: false, triggerDisabled: false },
  { props: {}, fieldDisabled: true, triggerDisabled: false },
])(
  'excludes a disabled icon from both submission channels',
  async ({ props, fieldDisabled, triggerDisabled }) => {
    const { client, form, submit, user } = renderForm(
      { defaultValue: initial, ...props },
      fieldDisabled,
      undefined,
      triggerDisabled,
    )
    expect(screen.getByRole('button', { name: 'Agent icon' })).toBeDisabled()
    expect(new FormData(form).has('icon')).toBe(false)
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(submit).toHaveBeenCalledExactlyOnceWith({}, expect.anything())
    client.clear()
  },
)

it('keeps the value submitted when only its trigger is disabled', async () => {
  const { client, form, submit, user } = renderForm(
    { defaultValue: initial },
    false,
    undefined,
    true,
  )
  expect(screen.getByRole('button', { name: 'Agent icon' })).toBeDisabled()
  expect(new FormData(form).get('icon')).toBe(JSON.stringify(initial))
  await user.click(screen.getByRole('button', { name: 'Save' }))
  expect(submit).toHaveBeenCalledExactlyOnceWith({ icon: initial }, expect.anything())
  client.clear()
})

it('submits a read-only icon while preventing its editor from opening', async () => {
  const { client, submit, user } = renderForm({ defaultValue: initial, readOnly: true })
  const trigger = screen.getByRole('button', { name: 'Agent icon' })
  await user.click(trigger)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Save' }))
  expect(submit).toHaveBeenCalledExactlyOnceWith({ icon: initial }, expect.anything())
  client.clear()
})
