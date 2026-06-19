'use client'

import type { CreateReleaseFormValues } from './types'
import { useForm } from '@tanstack/react-form'
import { DEFAULT_CREATE_RELEASE_FORM_VALUES } from './types'

export const RELEASE_NAME_REQUIRED_ERROR = 'releaseNameRequired'

export function validateReleaseName({ value }: {
  value: string
}) {
  return value.trim() ? undefined : RELEASE_NAME_REQUIRED_ERROR
}

export function useCreateReleaseForm({ onSubmit }: {
  onSubmit: (value: CreateReleaseFormValues) => Promise<void> | void
}) {
  return useForm({
    defaultValues: DEFAULT_CREATE_RELEASE_FORM_VALUES,
    onSubmit: ({ value }) => onSubmit(value),
  })
}

export type CreateReleaseForm = ReturnType<typeof useCreateReleaseForm>
