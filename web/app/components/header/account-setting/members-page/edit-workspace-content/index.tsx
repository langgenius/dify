'use client'
import type { Ref } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  DialogBody,
  DialogClose,
  DialogFooter,
  DialogHeader,
  DialogHeaderCloseButton,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { Input } from '@langgenius/dify-ui/input'
import { useAtomValue } from 'jotai'
import { useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
import { currentWorkspaceAtom, isCurrentWorkspaceOwnerAtom } from '@/context/workspace-state'
import { consoleClient } from '@/service/console'
import { getErrorMessage } from '@/utils/error-message'

type IEditWorkspaceContentProps = {
  inputRef: Ref<HTMLInputElement>
}
const EditWorkspaceContent = ({ inputRef }: IEditWorkspaceContentProps) => {
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
      await consoleClient.workspaces.info.post(
        {
          body: {
            name: normalizedName,
          },
        },
        { context: { silent: true } },
      )
      location.assign(`${location.origin}`)
    } catch (error) {
      toast.error(
        getErrorMessage(error) ?? t(($) => $['actionMsg.modifiedUnsuccessfully'], { ns: 'common' }),
      )
    } finally {
      setIsSubmitting(false)
    }
  }
  return (
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
        <DialogHeaderCloseButton aria-label={t(($) => $['operation.close'], { ns: 'common' })} />
      </DialogHeader>

      <DialogBody className="space-y-2">
        <label htmlFor={inputId} className="block text-sm font-medium text-text-primary">
          {t(($) => $['account.workspaceName'], { ns: 'accountSettings' })}
        </label>
        <Input
          ref={inputRef}
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
        <DialogClose render={<Button size="large" type="button" />}>
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
      </DialogFooter>
    </form>
  )
}
export default EditWorkspaceContent
