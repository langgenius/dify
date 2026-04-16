'use client'
import { cn } from '@langgenius/dify-ui/cn'
import { useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Input from '@/app/components/base/input'
import { Button } from '@/app/components/base/ui/button'
import { Dialog, DialogCloseButton, DialogContent, DialogTitle } from '@/app/components/base/ui/dialog'
import { toast } from '@/app/components/base/ui/toast'
import { useAppContext } from '@/context/app-context'
import { updateWorkspaceInfo } from '@/service/common'

type IEditWorkspaceModalProps = {
  onCancel: () => void
}
const EditWorkspaceModal = ({ onCancel }: IEditWorkspaceModalProps) => {
  const { t } = useTranslation()
  const { currentWorkspace, isCurrentWorkspaceOwner } = useAppContext()
  const [name, setName] = useState<string>(currentWorkspace.name)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const inputId = useId()
  const errorId = useId()
  const normalizedName = name.trim()
  const hasChanges = normalizedName !== currentWorkspace.name
  const hasError = normalizedName.length === 0
  const isSaveDisabled = !isCurrentWorkspaceOwner || !hasChanges || hasError || isSubmitting
  const nameErrorMessage = useMemo(() => {
    if (!hasError)
      return ''
    return t('errorMsg.fieldRequired', {
      ns: 'common',
      field: t('account.workspaceName', { ns: 'common' }),
    })
  }, [hasError, t])
  const changeWorkspaceInfo = async () => {
    if (isSaveDisabled)
      return
    setIsSubmitting(true)
    try {
      await updateWorkspaceInfo({
        url: '/workspaces/info',
        body: {
          name: normalizedName,
        },
      })
      toast.success(t('actionMsg.modifiedSuccessfully', { ns: 'common' }))
      location.assign(`${location.origin}`)
    }
    catch {
      toast.error(t('actionMsg.modifiedUnsuccessfully', { ns: 'common' }))
    }
    finally {
      setIsSubmitting(false)
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open)
          onCancel()
      }}
    >
      <DialogContent backdropProps={{ forceRender: true }} className="overflow-visible">
        <DialogCloseButton data-testid="edit-workspace-close" />

        <form
          className="flex flex-col"
          onSubmit={(e) => {
            e.preventDefault()
            void changeWorkspaceInfo()
          }}
        >
          <div className="mb-4 pr-8">
            <DialogTitle className="text-xl font-semibold text-text-primary" data-testid="edit-workspace-title">
              {t('account.editWorkspaceInfo', { ns: 'common' })}
            </DialogTitle>
          </div>

          <div className="space-y-2">
            <label htmlFor={inputId} className="block text-sm font-medium text-text-primary">
              {t('account.workspaceName', { ns: 'common' })}
            </label>
            <Input
              id={inputId}
              autoFocus
              value={name}
              placeholder={t('account.workspaceNamePlaceholder', { ns: 'common' })}
              onChange={(e) => {
                setName(e.target.value)
              }}
              aria-invalid={hasError}
              aria-describedby={hasError ? errorId : undefined}
              className={cn(hasError && 'border-components-input-border-destructive bg-components-input-bg-destructive hover:border-components-input-border-destructive hover:bg-components-input-bg-destructive focus:border-components-input-border-destructive focus:bg-components-input-bg-destructive')}
            />
            <div className="min-h-6">
              {hasError && (
                <p id={errorId} data-testid="edit-workspace-error" className="system-xs-regular text-text-destructive" role="alert">
                  {nameErrorMessage}
                </p>
              )}
            </div>
          </div>

          <div className="sticky bottom-0 -mx-2 mt-2 flex flex-wrap items-center justify-end gap-x-2 bg-components-panel-bg px-2 pt-4">
            <Button size="large" type="button" data-testid="edit-workspace-cancel" onClick={onCancel}>
              {t('operation.cancel', { ns: 'common' })}
            </Button>
            <Button size="large" type="submit" variant="primary" data-testid="edit-workspace-save" disabled={isSaveDisabled} loading={isSubmitting}>
              {t(isSubmitting ? 'operation.saving' : 'operation.save', { ns: 'common' })}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
export default EditWorkspaceModal
