'use client'

import type { CreateReleaseFormValues } from './types'
import { atom } from 'jotai'
import {
  atomWithForm,
  createFormAtoms,
} from 'jotai-tanstack-form'
import { DEFAULT_CREATE_RELEASE_FORM_VALUES } from './types'

export const RELEASE_NAME_REQUIRED_ERROR = 'releaseNameRequired'

export function validateReleaseName({ value }: {
  value: string
}) {
  return value.trim() ? undefined : RELEASE_NAME_REQUIRED_ERROR
}

function validateCreateReleaseValues({ value }: {
  value: CreateReleaseFormValues
}) {
  const releaseNameError = validateReleaseName({ value: value.releaseName })
  if (!releaseNameError)
    return undefined

  return {
    fields: {
      releaseName: releaseNameError,
    },
  }
}

type CreateReleaseSubmit = (value: CreateReleaseFormValues) => Promise<void> | void

type CreateReleaseSubmitMeta = {
  createRelease: CreateReleaseSubmit
}

const noopCreateRelease: CreateReleaseSubmit = () => undefined

export const createReleaseFormAtom = atomWithForm({
  defaultValues: DEFAULT_CREATE_RELEASE_FORM_VALUES,
  onSubmitMeta: {
    createRelease: noopCreateRelease,
  },
  validators: {
    onBlur: validateCreateReleaseValues,
    onSubmit: validateCreateReleaseValues,
  },
  onSubmit: ({ value, meta }) => meta.createRelease(value),
})

const createReleaseFormAtoms = createFormAtoms(createReleaseFormAtom)

export const createReleaseFormStateAtom = createReleaseFormAtoms.stateAtom
export const createReleaseFormValuesAtom = createReleaseFormAtoms.valuesAtom
export const createReleaseFormIsSubmittingAtom = createReleaseFormAtoms.isSubmittingAtom
export const setCreateReleaseFormFieldAtom = createReleaseFormAtoms.setFieldAtom
export const createReleaseSourceModeFieldAtom = createReleaseFormAtoms.fieldAtom('releaseSourceMode')
export const createReleaseSourceAppFieldAtom = createReleaseFormAtoms.fieldAtom('sourceApp')
export const createReleaseDslFileFieldAtom = createReleaseFormAtoms.fieldAtom('dslFile')
export const createReleaseNameFieldAtom = createReleaseFormAtoms.fieldAtom('releaseName')
export const createReleaseDescriptionFieldAtom = createReleaseFormAtoms.fieldAtom('releaseDescription')
export const validateCreateReleaseFormAtom = createReleaseFormAtoms.validateAtom
export const submitCreateReleaseFormAtom = atom(null, (get, _set, createRelease: CreateReleaseSubmit) => {
  const form = get(createReleaseFormAtom)

  return form.api.handleSubmit({ createRelease } satisfies CreateReleaseSubmitMeta)
})
