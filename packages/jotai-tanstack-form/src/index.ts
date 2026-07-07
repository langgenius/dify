import type {
  AnyFieldLikeMeta,
  DeepKeys,
  DeepValue,
  FormAsyncValidateOrFn,
  FormValidateOrFn,
  UpdateMetaOptions,
  Updater,
  ValidationCause,
} from '@tanstack/form-core'
import type {
  Atom,
  WritableAtom,
} from 'jotai'
import { FormApi } from '@tanstack/form-core'
import { atom } from 'jotai'
import { atomWithLazy } from 'jotai/vanilla/utils'

type FormValidator<TValues> = FormValidateOrFn<TValues> | undefined
type FormAsyncValidator<TValues> = FormAsyncValidateOrFn<TValues> | undefined

export type TanStackFormApi<
  TValues,
  TSubmitMeta = never,
> = FormApi<
  TValues,
  FormValidator<TValues>,
  FormValidator<TValues>,
  FormAsyncValidator<TValues>,
  FormValidator<TValues>,
  FormAsyncValidator<TValues>,
  FormValidator<TValues>,
  FormAsyncValidator<TValues>,
  FormValidator<TValues>,
  FormAsyncValidator<TValues>,
  FormAsyncValidator<TValues>,
  TSubmitMeta
>

export type FormState<TValues, TSubmitMeta = never> = TanStackFormApi<TValues, TSubmitMeta>['state']

type FormOptionsInput<TValues, TSubmitMeta = never> = TanStackFormApi<TValues, TSubmitMeta>['options']

export type FormFieldAtomValue<TValue> = {
  value: TValue
  meta: AnyFieldLikeMeta | undefined
}

export type FormFieldUpdate<
  TValues,
  TField extends DeepKeys<TValues> = DeepKeys<TValues>,
> = TField extends DeepKeys<TValues>
  ? {
      name: TField
      value: Updater<DeepValue<TValues, TField>>
      options?: UpdateMetaOptions
    }
  : never

export type FormAtomInstance<TValues, TSubmitMeta = never> = {
  api: TanStackFormApi<TValues, TSubmitMeta>
  stateAtom: Atom<FormState<TValues, TSubmitMeta>>
}

export type FormAtom<TValues, TSubmitMeta = never> = Atom<FormAtomInstance<TValues, TSubmitMeta>>

export type FormAtoms<TValues, TSubmitMeta = never> = {
  formAtom: FormAtom<TValues, TSubmitMeta>
  stateAtom: Atom<FormState<TValues, TSubmitMeta>>
  valuesAtom: Atom<TValues>
  isSubmittingAtom: Atom<boolean>
  setFieldAtom: WritableAtom<null, [FormFieldUpdate<TValues>], void>
  fieldAtom: <TField extends DeepKeys<TValues>>(
    name: TField,
  ) => WritableAtom<
    FormFieldAtomValue<DeepValue<TValues, TField>>,
    [Updater<DeepValue<TValues, TField>>, UpdateMetaOptions?],
    void
  >
  validateAtom: WritableAtom<null, [ValidationCause], unknown | Promise<unknown>>
  submitAtom: WritableAtom<null, [], Promise<void>>
}

function createFormInstance<TValues, TSubmitMeta = never>(
  api: TanStackFormApi<TValues, TSubmitMeta>,
): FormAtomInstance<TValues, TSubmitMeta> {
  const stateAtom = atom(api.state)

  stateAtom.onMount = (setFormState) => {
    const mountCleanup = api.mount()
    setFormState(api.state)

    const subscription = api.store.subscribe(() => {
      setFormState(api.state)
    })

    return () => {
      subscription.unsubscribe()
      mountCleanup()
    }
  }

  return {
    api,
    stateAtom,
  }
}

function setFormFieldValue<
  TValues,
  TSubmitMeta,
  TField extends DeepKeys<TValues>,
>(
  form: FormAtomInstance<TValues, TSubmitMeta>,
  name: TField,
  value: Updater<DeepValue<TValues, TField>>,
  options?: UpdateMetaOptions,
) {
  const shouldValidate = !options?.dontValidate
    && !(options?.dontUpdateMeta && !form.api.getFieldMeta(name)?.isTouched)

  form.api.setFieldValue(name, value, shouldValidate ? options : { ...(options ?? {}), dontValidate: true })

  if (!shouldValidate)
    return

  const fieldMeta = form.api.getFieldMeta(name)
  if (!fieldMeta?.errorMap.onSubmit)
    return

  if (fieldMeta.errorMap.onChange || fieldMeta.errorMap.onDynamic)
    return

  form.api.setFieldMeta(name, prev => ({
    ...prev,
    errorMap: {
      ...prev.errorMap,
      onSubmit: undefined,
    },
    errorSourceMap: {
      ...prev.errorSourceMap,
      onSubmit: undefined,
    },
  }))
}

export function atomWithForm<TValues, TSubmitMeta = never>(
  options: FormOptionsInput<TValues, TSubmitMeta>,
): FormAtom<TValues, TSubmitMeta> {
  return atomWithLazy(() => createFormInstance(new FormApi(options)))
}

export function createFormAtoms<TValues, TSubmitMeta = never>(
  formAtom: FormAtom<TValues, TSubmitMeta>,
): FormAtoms<TValues, TSubmitMeta> {
  const stateAtom = atom((get) => {
    const form = get(formAtom)
    return get(form.stateAtom)
  })

  const valuesAtom = atom((get) => {
    return get(stateAtom).values
  })

  const isSubmittingAtom = atom((get) => {
    return get(stateAtom).isSubmitting
  })

  const setFieldAtom = atom<null, [FormFieldUpdate<TValues>], void>(null, (get, _set, update) => {
    setFormFieldValue(get(formAtom), update.name, update.value, update.options)
  })

  function fieldAtom<TField extends DeepKeys<TValues>>(
    name: TField,
  ): WritableAtom<
    FormFieldAtomValue<DeepValue<TValues, TField>>,
    [Updater<DeepValue<TValues, TField>>, UpdateMetaOptions?],
    void
  > {
    return atom(
      (get) => {
        const form = get(formAtom)
        const state = get(form.stateAtom)
        const api = form.api

        return {
          value: api.getFieldValue(name),
          meta: state.fieldMeta[name],
        }
      },
      (get, _set, value, options) => {
        setFormFieldValue(get(formAtom), name, value, options)
      },
    )
  }

  const validateAtom = atom<null, [ValidationCause], unknown | Promise<unknown>>(null, (get, _set, cause) => {
    return get(formAtom).api.validate(cause)
  })

  const submitAtom = atom<null, [], Promise<void>>(null, (get) => {
    return get(formAtom).api.handleSubmit()
  })

  return {
    formAtom,
    stateAtom,
    valuesAtom,
    isSubmittingAtom,
    setFieldAtom,
    fieldAtom,
    validateAtom,
    submitAtom,
  }
}
