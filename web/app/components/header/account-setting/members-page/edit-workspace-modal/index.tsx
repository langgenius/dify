'use client'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from '@langgenius/dify-ui/dialog'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Input } from '@langgenius/dify-ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useAtomValue } from 'jotai'
import { useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
import { currentWorkspaceAtom, isCurrentWorkspaceOwnerAtom } from '@/context/workspace-state'
import { updateWorkspaceInfo } from '@/service/common'

type EditWorkspaceFormProps = {
  isSubmitting: boolean
  onSave: (name: string) => Promise<void>
}

function EditWorkspaceForm({ isSubmitting, onSave }: EditWorkspaceFormProps) {
  const { t } = useTranslation(['common', 'accountSettings'])
  const currentWorkspace = useAtomValue(currentWorkspaceAtom)
  const isCurrentWorkspaceOwner = useAtomValue(isCurrentWorkspaceOwnerAtom)
  const [name, setName] = useState<string>(currentWorkspace.name)
  const inputId = useId()
  const errorId = useId()
  const saveButtonLabelId = useId()
  const normalizedName = name.trim()
  const hasChanges = normalizedName !== currentWorkspace.name
  const hasError = normalizedName.length === 0
  const isSaveUnavailable = !isCurrentWorkspaceOwner || !hasChanges || hasError
  const nameErrorMessage = useMemo(() => {
    if (!hasError) return ''
    return t(($) => $['errorMsg.fieldRequired'], {
      ns: 'common',
      field: t(($) => $['account.workspaceName'], { ns: 'accountSettings' }),
    })
  }, [hasError, t])
  return (
    <>
      <DialogClose
        disabled={isSubmitting}
        render={
          <IconButton
            aria-label={t(($) => $['operation.close'], { ns: 'common' })}
            size="lg"
            className="absolute inset-e-6 top-6"
          >
            <span aria-hidden className="i-ri-close-line size-4" />
          </IconButton>
        }
      />

      <form
        className="flex flex-col"
        onSubmit={(e) => {
          e.preventDefault()
          if (!isSubmitting && !isSaveUnavailable) void onSave(normalizedName)
        }}
      >
        <div className="mb-4 pr-8">
          <DialogTitle className="text-xl font-semibold text-text-primary">
            {t(($) => $['account.editWorkspaceInfo'], { ns: 'accountSettings' })}
          </DialogTitle>
        </div>

        <div className="space-y-2">
          <label htmlFor={inputId} className="block text-sm font-medium text-text-primary">
            {t(($) => $['account.workspaceName'], { ns: 'accountSettings' })}
          </label>
          <Input
            id={inputId}
            value={name}
            readOnly={isSubmitting}
            placeholder={t(($) => $['account.workspaceNamePlaceholder'], {
              ns: 'accountSettings',
            })}
            onChange={(e) => {
              setName(e.target.value)
            }}
            aria-invalid={hasError}
            aria-describedby={hasError ? errorId : undefined}
            className={cn(
              hasError &&
                'border-components-input-border-destructive bg-components-input-bg-destructive hover:border-components-input-border-destructive hover:bg-components-input-bg-destructive focus:border-components-input-border-destructive focus:bg-components-input-bg-destructive',
            )}
          />
          <div className="min-h-6">
            {hasError && (
              <p id={errorId} className="system-xs-regular text-text-destructive" role="alert">
                {nameErrorMessage}
              </p>
            )}
          </div>
        </div>

        <div className="sticky bottom-0 -mx-2 mt-2 flex flex-wrap items-center justify-end gap-x-2 bg-components-panel-bg px-2 pt-4">
          <DialogClose disabled={isSubmitting} render={<Button size="large" />}>
            {t(($) => $['operation.cancel'], { ns: 'common' })}
          </DialogClose>
          <Button
            size="large"
            type="submit"
            variant="primary"
            disabled={isSaveUnavailable}
            loading={isSubmitting}
            aria-labelledby={saveButtonLabelId}
          >
            <span id={saveButtonLabelId}>
              {t(($) => $[isSubmitting ? 'operation.saving' : 'operation.save'], {
                ns: 'common',
              })}
            </span>
          </Button>
        </div>
      </form>
    </>
  )
}
export function EditWorkspaceDialog() {
  const { t } = useTranslation(['common', 'accountSettings'])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const label = t(($) => $['account.editWorkspaceInfo'], { ns: 'accountSettings' })

  const changeWorkspaceInfo = async (name: string) => {
    if (isSubmitting) return
    setIsSubmitting(true)
    try {
      await updateWorkspaceInfo({
        url: '/workspaces/info',
        body: { name },
      })
      toast.success(t(($) => $['actionMsg.modifiedSuccessfully'], { ns: 'common' }))
      location.assign(`${location.origin}`)
    } catch {
      toast.error(t(($) => $['actionMsg.modifiedUnsuccessfully'], { ns: 'common' }))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog
      onOpenChange={(open, details) => {
        if (!open && isSubmitting) details.cancel()
      }}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <DialogTrigger
              render={
                <IconButton aria-label={label} size="md">
                  <span aria-hidden className="i-ri-pencil-line size-4 text-text-tertiary" />
                </IconButton>
              }
            />
          }
        />
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      <DialogContent backdropProps={{ forceRender: true }}>
        <EditWorkspaceForm isSubmitting={isSubmitting} onSave={changeWorkspaceInfo} />
      </DialogContent>
    </Dialog>
  )
}
