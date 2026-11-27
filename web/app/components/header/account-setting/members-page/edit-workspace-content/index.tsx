'use client'
import type { Ref } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import {
  DialogBody,
  DialogClose,
  DialogFooter,
  DialogHeader,
  DialogHeaderCloseButton,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { Field, FieldError } from '@langgenius/dify-ui/field'
import { Input } from '@langgenius/dify-ui/input'
import { useMutation } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
import { currentWorkspaceAtom, isCurrentWorkspaceOwnerAtom } from '@/context/workspace-state'
import { consoleQuery } from '@/service/console'
import { getErrorMessage } from '@/utils/error-message'

type IEditWorkspaceContentProps = {
  inputRef: Ref<HTMLInputElement>
}
export const EditWorkspaceContent = ({ inputRef }: IEditWorkspaceContentProps) => {
  const { t } = useTranslation(['common', 'accountSettings'])
  const currentWorkspace = useAtomValue(currentWorkspaceAtom)
  const isCurrentWorkspaceOwner = useAtomValue(isCurrentWorkspaceOwnerAtom)
  const [name, setName] = useState<string>(currentWorkspace.name)
  // Outcome handlers live on the hook so they still run if the dialog unmounts mid-request.
  const { isPending: isSubmitting, mutate: updateWorkspaceInfo } = useMutation(
    consoleQuery.workspaces.info.post.mutationOptions({
      meta: { errorToast: false },
      onSuccess: () => {
        location.assign(`${location.origin}`)
      },
      onError: (error) => {
        toast.error(
          getErrorMessage(error) ??
            t(($) => $['actionMsg.modifiedUnsuccessfully'], { ns: 'common' }),
        )
      },
    }),
  )
  const inputId = useId()
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
  const changeWorkspaceInfo = () => {
    if (isSubmitting || isSaveUnavailable) return
    updateWorkspaceInfo({ body: { name: normalizedName } })
  }
  return (
    <form
      className="contents"
      onSubmit={(e) => {
        e.preventDefault()
        changeWorkspaceInfo()
      }}
    >
      <DialogHeader>
        <DialogTitle>
          {t(($) => $['account.editWorkspaceInfo'], { ns: 'accountSettings' })}
        </DialogTitle>
        <DialogHeaderCloseButton aria-label={t(($) => $['operation.close'], { ns: 'common' })} />
      </DialogHeader>

      <DialogBody>
        <Field invalid={hasError} className="gap-2">
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
          />
          <div className="min-h-6">
            <FieldError match={hasError}>{nameErrorMessage}</FieldError>
          </div>
        </Field>
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
