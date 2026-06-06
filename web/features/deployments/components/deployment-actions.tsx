'use client'

import type { AppInstance } from '@dify/contracts/enterprise/types.gen'
import type { FormEvent } from 'react'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Dialog,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { Input } from '@langgenius/dify-ui/input'
import { Textarea } from '@langgenius/dify-ui/textarea'
import { toast } from '@langgenius/dify-ui/toast'
import { skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SkeletonRectangle, SkeletonRow } from '@/app/components/base/skeleton'
import { useRouter } from '@/next/navigation'
import { consoleClient, consoleQuery } from '@/service/client'

type AppInstanceWithId = AppInstance & { id: string }
type UpdateAppInstanceInput = Parameters<typeof consoleClient.enterprise.appInstanceService.updateAppInstance>[0]
type EditDeploymentFormValues = {
  name: string
  description: string
}

const ACTION_TRIGGER_CLASS_NAME = cn(
  'inline-flex size-8 items-center justify-center rounded-lg bg-components-panel-bg text-text-tertiary shadow-xs outline-hidden',
  'hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid',
  'data-popup-open:bg-state-base-hover data-popup-open:text-text-secondary',
)

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

function EditDeploymentForm({
  app,
  isSaving,
  onClose,
  onSubmit,
}: {
  app: AppInstanceWithId
  isSaving: boolean
  onClose: () => void
  onSubmit: (values: EditDeploymentFormValues) => void
}) {
  const { t } = useTranslation('deployments')
  const initialName = app.name ?? app.id
  const initialDescription = app.description ?? ''
  const [name, setName] = useState(initialName)
  const [description, setDescription] = useState(initialDescription)
  const normalizedName = name.trim()
  const normalizedDescription = description.trim()
  const canSave = Boolean(normalizedName && (normalizedName !== initialName || normalizedDescription !== initialDescription) && !isSaving)

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canSave)
      return

    onSubmit({
      name: normalizedName,
      description: normalizedDescription,
    })
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
      <div className="flex flex-col gap-2">
        <label className="system-xs-medium-uppercase text-text-tertiary" htmlFor="deployment-edit-name">
          {t('settings.name')}
        </label>
        <Input
          id="deployment-edit-name"
          type="text"
          value={name}
          onChange={event => setName(event.target.value)}
          className="h-8"
        />
      </div>
      <div className="flex flex-col gap-2">
        <label className="system-xs-medium-uppercase text-text-tertiary" htmlFor="deployment-edit-description">
          {t('settings.description')}
        </label>
        <Textarea
          id="deployment-edit-description"
          value={description}
          onValueChange={setDescription}
          className="min-h-24"
        />
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button
          type="button"
          variant="secondary"
          disabled={isSaving}
          onClick={onClose}
        >
          {t('createModal.cancel')}
        </Button>
        <Button
          type="submit"
          variant="primary"
          disabled={!canSave}
          loading={isSaving}
        >
          {t('settings.save')}
        </Button>
      </div>
    </form>
  )
}

function EditDeploymentDialog({
  appInstanceId,
  open,
  onOpenChange,
}: {
  appInstanceId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation('deployments')
  const queryClient = useQueryClient()
  const updateInstance = useMutation({
    mutationFn: (variables: UpdateAppInstanceInput) =>
      consoleClient.enterprise.appInstanceService.updateAppInstance(variables),
    onSuccess: (_data, variables) => {
      const updatedAppInstanceId = variables.params.appInstanceId

      toast.success(t('settings.updated'))
      onOpenChange(false)

      void Promise.all([
        queryClient.invalidateQueries({
          queryKey: consoleQuery.enterprise.appInstanceService.listAppInstances.key(),
        }),
        queryClient.invalidateQueries({
          queryKey: consoleQuery.enterprise.appInstanceService.listAppInstanceSummaries.key(),
        }),
        queryClient.invalidateQueries({
          queryKey: consoleQuery.enterprise.appInstanceService.getAppInstance.key({
            type: 'query',
            input: {
              params: {
                appInstanceId: updatedAppInstanceId,
              },
            },
          }),
        }),
        queryClient.invalidateQueries({
          queryKey: consoleQuery.enterprise.appInstanceService.getAppInstanceOverview.key({
            type: 'query',
            input: {
              params: {
                appInstanceId: updatedAppInstanceId,
              },
            },
          }),
        }),
      ])
    },
    onError: () => {
      toast.error(t('settings.updateFailed'))
    },
  })
  const instanceQuery = useQuery(consoleQuery.enterprise.appInstanceService.getAppInstance.queryOptions({
    input: open
      ? { params: { appInstanceId } }
      : skipToken,
  }))
  const app = instanceQuery.data?.appInstance
  const appWithId = app?.id ? { ...app, id: app.id } : undefined
  const formKey = appWithId ? `${appWithId.id}-${appWithId.name ?? ''}-${appWithId.description ?? ''}` : 'loading'

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && updateInstance.isPending)
      return
    onOpenChange(nextOpen)
  }

  function handleClose() {
    handleOpenChange(false)
  }

  function handleSubmit(values: EditDeploymentFormValues) {
    updateInstance.mutate({
      params: {
        appInstanceId,
      },
      body: {
        appInstanceId,
        name: values.name,
        description: values.description || undefined,
      },
    })
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="w-120 max-w-[calc(100vw-32px)] p-0">
        <DialogCloseButton disabled={updateInstance.isPending} />
        <div className="border-b border-divider-subtle px-6 py-5">
          <DialogTitle className="title-xl-semi-bold text-text-primary">
            {t('card.menu.editInfo')}
          </DialogTitle>
          <DialogDescription className="mt-1 system-sm-regular text-text-tertiary">
            {t('settings.descriptionHelp')}
          </DialogDescription>
        </div>
        <div className="px-6 py-5">
          {instanceQuery.isLoading
            ? <EditDeploymentFormSkeleton />
            : instanceQuery.isError
              ? <div className="system-sm-regular text-text-tertiary">{t('common.loadFailed')}</div>
              : appWithId
                ? (
                    <EditDeploymentForm
                      key={formKey}
                      app={appWithId}
                      isSaving={updateInstance.isPending}
                      onClose={handleClose}
                      onSubmit={handleSubmit}
                    />
                  )
                : <div className="system-sm-regular text-text-tertiary">{t('detail.notFound')}</div>}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function DeleteDeploymentDialog({
  appInstanceId,
  appName,
  open,
  onOpenChange,
}: {
  appInstanceId: string
  appName?: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation('deployments')
  const router = useRouter()
  const deleteInstance = useMutation(consoleQuery.enterprise.appInstanceService.deleteAppInstance.mutationOptions())
  const displayName = appName || appInstanceId

  function handleDelete() {
    deleteInstance.mutate(
      {
        params: {
          appInstanceId,
        },
      },
      {
        onSuccess: () => {
          toast.success(t('settings.deleted'))
          router.push('/deployments')
        },
        onError: () => {
          toast.error(t('settings.deleteFailed'))
        },
        onSettled: () => {
          onOpenChange(false)
        },
      },
    )
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && deleteInstance.isPending)
          return
        onOpenChange(nextOpen)
      }}
    >
      <AlertDialogContent className="w-120">
        <div className="flex flex-col gap-3 px-6 pt-6 pb-2">
          <AlertDialogTitle className="title-2xl-semi-bold text-text-primary">
            {t('settings.deleteConfirmTitle')}
          </AlertDialogTitle>
          <AlertDialogDescription className="system-sm-regular text-text-tertiary">
            {t('settings.deleteConfirmDesc', { name: displayName })}
          </AlertDialogDescription>
        </div>
        <AlertDialogActions className="pt-3">
          <AlertDialogCancelButton variant="secondary" disabled={deleteInstance.isPending}>
            {t('createModal.cancel')}
          </AlertDialogCancelButton>
          <AlertDialogConfirmButton
            loading={deleteInstance.isPending}
            onClick={handleDelete}
          >
            {t('settings.delete')}
          </AlertDialogConfirmButton>
        </AlertDialogActions>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export function DeploymentActionsMenu({
  appInstanceId,
  appName,
  className,
  triggerClassName,
}: {
  appInstanceId: string
  appName?: string
  className?: string
  triggerClassName?: string
}) {
  const { t } = useTranslation('deployments')
  const [menuOpen, setMenuOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  return (
    <div
      className={className}
      onClick={event => event.stopPropagation()}
      onKeyDown={event => event.stopPropagation()}
    >
      <DropdownMenu modal={false} open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger
          aria-label={t('card.moreActions')}
          className={cn(ACTION_TRIGGER_CLASS_NAME, triggerClassName)}
        >
          <span aria-hidden className="i-ri-more-fill size-4" />
        </DropdownMenuTrigger>
        {menuOpen && (
          <DropdownMenuContent placement="bottom-end" sideOffset={4} popupClassName="min-w-44">
            <DropdownMenuItem
              className="gap-2 px-3"
              onClick={() => {
                setMenuOpen(false)
                setEditOpen(true)
              }}
            >
              <span aria-hidden className="i-ri-edit-line size-4 shrink-0 text-text-tertiary" />
              <span className="system-sm-regular text-text-secondary">{t('card.menu.editInfo')}</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              className="gap-2 px-3"
              onClick={() => {
                setMenuOpen(false)
                setDeleteOpen(true)
              }}
            >
              <span aria-hidden className="i-ri-delete-bin-line size-4 shrink-0" />
              <span className="system-sm-regular">{t('card.menu.delete')}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        )}
      </DropdownMenu>

      <EditDeploymentDialog
        appInstanceId={appInstanceId}
        open={editOpen}
        onOpenChange={setEditOpen}
      />
      <DeleteDeploymentDialog
        appInstanceId={appInstanceId}
        appName={appName}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
      />
    </div>
  )
}
