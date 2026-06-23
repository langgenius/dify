'use client'

import type { ExtractAtomValue } from 'jotai'
import type { Getter } from 'jotai/vanilla'
import { skipToken } from '@tanstack/react-query'
import { atom } from 'jotai'
import {
  atomWithForm,
  createFormAtoms,
} from 'jotai-tanstack-form'
import { atomWithMutation, atomWithQuery } from 'jotai-tanstack-query'
import { consoleQuery } from '@/service/client'

export type EditDeploymentFormValues = {
  name: string
  description: string
}

const DEFAULT_EDIT_DEPLOYMENT_FORM_VALUES: EditDeploymentFormValues = {
  name: '',
  description: '',
}

export const deploymentActionAppInstanceIdHydrationAtom = atom<string | undefined>(undefined)

export const editDeploymentDialogOpenAtom = atom(false)
export const deleteDeploymentDialogOpenAtom = atom(false)

export const editDeploymentFormAtom = atomWithForm({
  defaultValues: DEFAULT_EDIT_DEPLOYMENT_FORM_VALUES,
})

const editDeploymentFormAtoms = createFormAtoms(editDeploymentFormAtom)

const editDeploymentFormValuesAtom = editDeploymentFormAtoms.valuesAtom
export const editDeploymentNameFieldAtom = editDeploymentFormAtoms.fieldAtom('name')
export const editDeploymentDescriptionFieldAtom = editDeploymentFormAtoms.fieldAtom('description')

const deploymentActionAppInstanceIdAtom = atom((get): string => {
  const appInstanceId = get(deploymentActionAppInstanceIdHydrationAtom)
  if (!appInstanceId)
    throw new Error('Missing deployment action app instance id.')

  return appInstanceId
})

function normalizedEditDeploymentFormValues(value: EditDeploymentFormValues) {
  return {
    name: value.name.trim(),
    description: value.description.trim(),
  }
}

export const deploymentActionAppInstanceQueryAtom = atomWithQuery((get) => {
  const appInstanceId = get(deploymentActionAppInstanceIdAtom)
  const editOpen = get(editDeploymentDialogOpenAtom)
  const deleteOpen = get(deleteDeploymentDialogOpenAtom)
  const enabled = editOpen || deleteOpen

  return consoleQuery.enterprise.appInstanceService.getAppInstance.queryOptions({
    input: enabled
      ? {
          params: { appInstanceId },
        }
      : skipToken,
    enabled,
  })
})

export const deploymentActionDisplayNameAtom = atom((get): string => {
  return get(deploymentActionAppInstanceQueryAtom).data?.appInstance.displayName || get(deploymentActionAppInstanceIdAtom)
})

function editDeploymentInitialFormValues(get: Getter): EditDeploymentFormValues | undefined {
  const app = get(deploymentActionAppInstanceQueryAtom).data?.appInstance
  if (!app)
    return undefined

  return {
    name: app.displayName,
    description: app.description,
  }
}

function canSubmitEditDeploymentForm(get: Getter, value: EditDeploymentFormValues) {
  const initialValues = editDeploymentInitialFormValues(get)
  if (!initialValues)
    return false

  const normalizedValues = normalizedEditDeploymentFormValues(value)
  return Boolean(
    normalizedValues.name
    && (
      normalizedValues.name !== initialValues.name
      || normalizedValues.description !== initialValues.description
    ),
  )
}

export const updateDeploymentInstanceMutationAtom = atomWithMutation(() =>
  consoleQuery.enterprise.appInstanceService.updateAppInstance.mutationOptions(),
)

export const deleteDeploymentInstanceMutationAtom = atomWithMutation(() =>
  consoleQuery.enterprise.appInstanceService.deleteAppInstance.mutationOptions(),
)

export const setEditDeploymentDialogOpenAtom = atom(null, (get, set, open: boolean) => {
  if (!open && get(updateDeploymentInstanceMutationAtom).isPending)
    return

  set(editDeploymentDialogOpenAtom, open)
})

export const editDeploymentFormSavePendingAtom = atom((get) => {
  return get(updateDeploymentInstanceMutationAtom).isPending
})

export const editDeploymentFormCanSaveAtom = atom((get) => {
  return canSubmitEditDeploymentForm(get, get(editDeploymentFormValuesAtom))
    && !get(editDeploymentFormSavePendingAtom)
})

const submitEditDeploymentInstanceAtom = atom(null, async (get, _set, value: EditDeploymentFormValues) => {
  if (!canSubmitEditDeploymentForm(get, value))
    return undefined

  const appInstanceId = get(deploymentActionAppInstanceIdAtom)
  const updateInstance = get(updateDeploymentInstanceMutationAtom)
  const normalizedValues = normalizedEditDeploymentFormValues(value)

  return await updateInstance.mutateAsync({
    params: {
      appInstanceId,
    },
    body: {
      appInstanceId,
      displayName: normalizedValues.name,
      description: normalizedValues.description,
    },
  })
})

export const submitEditDeploymentFormAtom = atom(null, async (get, set) => {
  const response = await set(submitEditDeploymentInstanceAtom, get(editDeploymentFormValuesAtom))
  return Boolean(response)
})

type DeleteDeploymentInstanceMutationCallbacks = Parameters<ExtractAtomValue<typeof deleteDeploymentInstanceMutationAtom>['mutate']>[1]

export const submitDeleteDeploymentInstanceAtom = atom(null, (get, _set, callbacks?: DeleteDeploymentInstanceMutationCallbacks) => {
  const appInstanceId = get(deploymentActionAppInstanceIdAtom)
  const deleteInstance = get(deleteDeploymentInstanceMutationAtom)

  deleteInstance.mutate(
    {
      params: {
        appInstanceId,
      },
    },
    callbacks,
  )
})

export const deploymentActionsLocalAtoms = [
  editDeploymentDialogOpenAtom,
  deleteDeploymentDialogOpenAtom,
] as const
