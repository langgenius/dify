'use client'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { Input } from '@langgenius/dify-ui/input'
import { useAtomValue } from 'jotai'
import { useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
import { currentWorkspaceAtom, isCurrentWorkspaceOwnerAtom } from '@/context/workspace-state'
import { consoleClient } from '@/service/console'

type IEditWorkspaceModalProps = {
  onCancel: () => void
}
const EditWorkspaceModal = ({ onCancel }: IEditWorkspaceModalProps) => {
  const { t } = useTranslation(['common', 'accountSettings'])
  const currentWorkspace = useAtomValue(currentWorkspaceAtom)
  const isCurrentWorkspaceOwner = useAtomValue(isCurrentWorkspaceOwnerAtom)
  const [name, setName] = useState<string>(currentWorkspace.name)
  const [isSubmitting, setIsSubmitting] = useState(false)
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
  const changeWorkspaceInfo = async () => {
    if (isSubmitting || isSaveUnavailable) return
    setIsSubmitting(true)
    try {
      await consoleClient.workspaces.info.post({
        body: {
          name: normalizedName,
        },
      })
      location.assign(`${location.origin}`)
    } catch {
      toast.error(t(($) => $['actionMsg.modifiedUnsuccessfully'], { ns: 'common' }))
    } finally {
      setIsSubmitting(false)
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel()
      }}
    >
      <DialogContent backdropProps={{ forceRender: true }}>
        <form
          className="contents"
          onSubmit={(e) => {
            e.preventDefault()
            void changeWorkspaceInfo()
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {t(($) => $['account.editWorkspaceInfo'], { ns: 'accountSettings' })}
            </DialogTitle>
            <DialogCloseButton aria-label={t(($) => $['operation.close'], { ns: 'common' })} />
          </DialogHeader>

          <DialogBody className="space-y-2">
            <label htmlFor={inputId} className="block text-sm font-medium text-text-primary">
              {t(($) => $['account.workspaceName'], { ns: 'accountSettings' })}
            </label>
            <Input
              id={inputId}
              value={name}
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
          </DialogBody>

          <DialogFooter>
            <Button size="large" type="button" onClick={onCancel}>
              {t(($) => $['operation.cancel'], { ns: 'common' })}
            </Button>
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
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
export default EditWorkspaceModal
