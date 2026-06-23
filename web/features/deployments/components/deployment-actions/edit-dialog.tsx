'use client'

import type { FormEvent } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogCloseButton,
  DialogContent,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { Input } from '@langgenius/dify-ui/input'
import { Textarea } from '@langgenius/dify-ui/textarea'
import { toast } from '@langgenius/dify-ui/toast'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { ScopeProvider } from 'jotai-scope'
import { useTranslation } from 'react-i18next'
import { SkeletonRectangle, SkeletonRow } from '@/app/components/base/skeleton'
import {
  deploymentActionAppInstanceQueryAtom,
  editDeploymentDescriptionFieldAtom,
  editDeploymentDialogOpenAtom,
  editDeploymentFormAtom,
  editDeploymentFormCanSaveAtom,
  editDeploymentFormSavePendingAtom,
  editDeploymentNameFieldAtom,
  setEditDeploymentDialogOpenAtom,
  submitEditDeploymentFormAtom,
  updateDeploymentInstanceMutationAtom,
} from './state'

function EditDeploymentFormSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <SkeletonRectangle className="my-0 h-3 w-24 animate-pulse" />
        <SkeletonRectangle className="my-0 h-8 w-full animate-pulse rounded-lg" />
      </div>
      <div className="flex flex-col gap-2">
        <SkeletonRectangle className="my-0 h-3 w-28 animate-pulse" />
        <SkeletonRectangle className="my-0 h-24 w-full animate-pulse rounded-lg" />
      </div>
      <SkeletonRow className="justify-end gap-2">
        <SkeletonRectangle className="my-0 h-8 w-16 animate-pulse rounded-lg" />
        <SkeletonRectangle className="my-0 h-8 w-24 animate-pulse rounded-lg" />
      </SkeletonRow>
    </div>
  )
}

function EditDeploymentForm() {
  const { t } = useTranslation('deployments')
  const [nameField, setNameField] = useAtom(editDeploymentNameFieldAtom)
  const [descriptionField, setDescriptionField] = useAtom(editDeploymentDescriptionFieldAtom)
  const canSave = useAtomValue(editDeploymentFormCanSaveAtom)
  const savePending = useAtomValue(editDeploymentFormSavePendingAtom)
  const submitEditDeploymentForm = useSetAtom(submitEditDeploymentFormAtom)
  const requestOpenChange = useSetAtom(setEditDeploymentDialogOpenAtom)
  const setOpen = useSetAtom(editDeploymentDialogOpenAtom)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    event.stopPropagation()

    if (!canSave)
      return

    try {
      const didSubmit = await submitEditDeploymentForm()
      if (!didSubmit)
        return

      toast.success(t('settings.updated'))
      setOpen(false)
    }
    catch {
      toast.error(t('settings.updateFailed'))
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
      <div className="flex flex-col gap-2">
        <label className="system-xs-medium-uppercase text-text-tertiary" htmlFor="deployment-edit-name">
          {t('settings.name')}
        </label>
        <Input
          id="deployment-edit-name"
          name="name"
          type="text"
          value={nameField.value}
          onChange={event => setNameField(event.target.value)}
          className="h-8"
        />
      </div>
      <div className="flex flex-col gap-2">
        <label className="system-xs-medium-uppercase text-text-tertiary" htmlFor="deployment-edit-description">
          {t('settings.description')}
        </label>
        <Textarea
          id="deployment-edit-description"
          name="description"
          value={descriptionField.value}
          onValueChange={value => setDescriptionField(value)}
          className="min-h-24"
        />
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button
          type="button"
          variant="secondary"
          disabled={savePending}
          onClick={() => requestOpenChange(false)}
        >
          {t('createModal.cancel')}
        </Button>
        <Button
          type="submit"
          variant="primary"
          disabled={!canSave}
          loading={savePending}
        >
          {t('settings.save')}
        </Button>
      </div>
    </form>
  )
}

export function EditDeploymentDialog() {
  const { t } = useTranslation('deployments')
  const open = useAtomValue(editDeploymentDialogOpenAtom)
  const setOpen = useSetAtom(setEditDeploymentDialogOpenAtom)
  const updateInstance = useAtomValue(updateDeploymentInstanceMutationAtom)
  const instanceQuery = useAtomValue(deploymentActionAppInstanceQueryAtom)
  const app = instanceQuery.data?.appInstance
  const formKey = app ? `${app.id}-${app.displayName}-${app.description}` : 'loading'

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="w-120 max-w-[calc(100vw-32px)] p-0">
        <DialogCloseButton disabled={updateInstance.isPending} />
        <div className="border-b border-divider-subtle px-6 py-5">
          <DialogTitle className="title-xl-semi-bold text-text-primary">
            {t('card.menu.editInfo')}
          </DialogTitle>
        </div>
        <div className="px-6 py-5">
          {instanceQuery.isLoading
            ? <EditDeploymentFormSkeleton />
            : instanceQuery.isError
              ? <div className="system-sm-regular text-text-tertiary">{t('common.loadFailed')}</div>
              : app
                ? (
                    <ScopeProvider
                      key={formKey}
                      atoms={[
                        editDeploymentFormAtom,
                        [editDeploymentNameFieldAtom, app.displayName],
                        [editDeploymentDescriptionFieldAtom, app.description],
                      ]}
                      name="EditDeploymentForm"
                    >
                      <EditDeploymentForm />
                    </ScopeProvider>
                  )
                : <div className="system-sm-regular text-text-tertiary">{t('detail.notFound')}</div>}
        </div>
      </DialogContent>
    </Dialog>
  )
}
