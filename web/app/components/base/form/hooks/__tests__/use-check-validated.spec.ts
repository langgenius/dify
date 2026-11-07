import type { FormSchema } from '../../types'
import { useForm } from '@tanstack/react-form'
import { act, renderHook } from '@testing-library/react'
import { FormTypeEnum } from '../../types'
import { useCheckValidated } from '../use-check-validated'

const notify = vi.hoisted(() => vi.fn())
vi.mock('@/app/notifications', () => ({ toast: { error: notify } }))

const schema = (name: string, show_on: FormSchema['show_on'] = []): FormSchema => ({
  name,
  label: name,
  type: FormTypeEnum.textInput,
  required: true,
  show_on,
})

function renderValidation(schemas: FormSchema[], values: Record<string, unknown> = {}) {
  const onInvalidField = vi.fn()
  const view = renderHook(() => {
    const form = useForm({ defaultValues: values })
    return { form, ...useCheckValidated(form, schemas, onInvalidField) }
  })
  const setErrors = (errors: Record<string, string[]>) =>
    act(() => {
      for (const [name, messages] of Object.entries(errors)) {
        view.result.current.form.setFieldMeta(name, (previous) => ({
          ...previous,
          errorMap: { onChange: messages },
        }))
      }
    })
  return { ...view, setErrors, onInvalidField }
}

beforeEach(() => vi.clearAllMocks())

it('allows a form without field errors', () => {
  const { result, onInvalidField } = renderValidation([schema('name')], { name: 'Dify' })
  expect(result.current.checkValidated()).toBe(true)
  expect(notify).not.toHaveBeenCalled()
  expect(onInvalidField).not.toHaveBeenCalled()
})

it('reports and focuses the first invalid field in schema order', () => {
  const { result, setErrors, onInvalidField } = renderValidation([schema('name'), schema('email')])
  setErrors({ email: ['Email error'], name: ['First name error', 'Second name error'] })

  expect(result.current.checkValidated()).toBe(false)
  expect(notify).toHaveBeenCalledExactlyOnceWith('First name error')
  expect(onInvalidField).toHaveBeenCalledExactlyOnceWith('name')
})

it.each([
  { enabled: 'true', level: 'advanced', visible: true },
  { enabled: 'false', level: 'advanced', visible: false },
  { enabled: 'true', level: 'basic', visible: false },
])(
  'validates conditional fields only when every condition matches: $enabled/$level',
  ({ enabled, level, visible }) => {
    const { result, setErrors, onInvalidField } = renderValidation(
      [
        schema('secret', [
          { variable: 'enabled', value: 'true' },
          { variable: 'level', value: 'advanced' },
        ]),
      ],
      { enabled, level },
    )
    setErrors({ secret: ['Secret is required'] })

    expect(result.current.checkValidated()).toBe(!visible)
    if (visible) {
      expect(notify).toHaveBeenCalledExactlyOnceWith('Secret is required')
      expect(onInvalidField).toHaveBeenCalledExactlyOnceWith('secret')
    } else {
      expect(notify).not.toHaveBeenCalled()
      expect(onInvalidField).not.toHaveBeenCalled()
    }
  },
)

it('uses current form values after a visibility condition changes', () => {
  const { result, setErrors } = renderValidation(
    [schema('secret', [{ variable: 'enabled', value: 'true' }])],
    { enabled: 'false' },
  )
  setErrors({ secret: ['Secret is required'] })
  expect(result.current.checkValidated()).toBe(true)

  act(() => result.current.form.setFieldValue('enabled', 'true'))

  expect(result.current.checkValidated()).toBe(false)
  expect(notify).toHaveBeenCalledExactlyOnceWith('Secret is required')
})

it('does not silently discard an error for a field absent from the schema', () => {
  const { result, setErrors, onInvalidField } = renderValidation([schema('known')])
  setErrors({ unknown: ['Unknown field error'] })

  expect(result.current.checkValidated()).toBe(false)
  expect(notify).toHaveBeenCalledExactlyOnceWith('Unknown field error')
  expect(onInvalidField).toHaveBeenCalledExactlyOnceWith('unknown')
})
