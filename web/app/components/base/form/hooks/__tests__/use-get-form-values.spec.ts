import { useField, useForm } from '@tanstack/react-form'
import { act, renderHook } from '@testing-library/react'
import { toast } from '@/app/notifications'
import { FormTypeEnum } from '../../types'
import { useGetFormValues } from '../use-get-form-values'

afterEach(() => vi.restoreAllMocks())

const setup = () =>
  renderHook(() => {
    const form = useForm({ defaultValues: { name: 'Alice', password: 'saved-secret' } })
    const name = useField({
      form,
      name: 'name',
      validators: { onChange: ({ value }) => (value ? undefined : 'Name required') },
    })
    const password = useField({ form, name: 'password' })
    const onInvalid = vi.fn()
    const values = useGetFormValues(
      form,
      [
        { name: 'name', label: 'Name', required: true, type: FormTypeEnum.textInput },
        { name: 'password', label: 'Password', required: true, type: FormTypeEnum.secretInput },
      ],
      onInvalid,
    )
    return { form, name, password, onInvalid, ...values }
  })

it('masks saved secrets until they are edited without altering the form data', () => {
  const { result } = setup()
  const options = { needTransformWhenSecretFieldIsPristine: true }
  expect(result.current.getFormValues(options)).toEqual({
    isCheckValidated: true,
    values: { name: 'Alice', password: '[__HIDDEN__]' },
  })
  expect(result.current.form.state.values.password).toBe('saved-secret')
  act(() => result.current.password.handleChange('new-secret'))
  expect(result.current.getFormValues(options)).toEqual({
    isCheckValidated: true,
    values: { name: 'Alice', password: 'new-secret' },
  })
})

it('rejects invalid values and allows submission after the field is corrected', () => {
  const error = vi.spyOn(toast, 'error').mockReturnValue('error')
  const { result } = setup()
  act(() => result.current.name.handleChange(''))
  expect(result.current.getFormValues({})).toEqual({ values: {}, isCheckValidated: false })
  expect(error).toHaveBeenCalledWith('Name required')
  expect(result.current.onInvalid).toHaveBeenCalledWith('name')
  act(() => result.current.name.handleChange('Bob'))
  expect(result.current.getFormValues({})).toEqual({
    values: { name: 'Bob', password: 'saved-secret' },
    isCheckValidated: true,
  })
})

it('returns raw values without validation or masking when validation is explicitly skipped', () => {
  const error = vi.spyOn(toast, 'error').mockReturnValue('error')
  const { result } = setup()
  act(() => result.current.name.handleChange(''))
  expect(
    result.current.getFormValues({
      needCheckValidatedValues: false,
      needTransformWhenSecretFieldIsPristine: true,
    }),
  ).toEqual({ values: { name: '', password: 'saved-secret' }, isCheckValidated: true })
  expect(error).not.toHaveBeenCalled()
})
