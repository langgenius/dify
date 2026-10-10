import type { Credential, PluginPayload } from '../types'
import { Button } from '@langgenius/dify-ui/button'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import { cn } from '@langgenius/dify-ui/cn'
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@langgenius/dify-ui/dialog'
import { Field, FieldError, FieldLabel } from '@langgenius/dify-ui/field'
import { Input } from '@langgenius/dify-ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectLabel,
  SelectTrigger,
} from '@langgenius/dify-ui/select'
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
import { useCredentialPermissions } from '@/hooks/use-credential-permissions'
import { PermissionLevel } from '@/models/permission'
import { consoleQuery } from '@/service/console'

type EditConnectionModalProps = {
  credential: Credential
  pluginPayload: PluginPayload
  providerName?: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onCloseComplete: () => void
  onUpdate: () => void
}

const EditConnectionModal = ({
  credential,
  pluginPayload,
  providerName,
  open,
  onOpenChange,
  onCloseComplete,
  onUpdate,
}: EditConnectionModalProps) => {
  const { t } = useTranslation(['common', 'plugin', 'datasetSettings'])
  const { canUseCredential, canManageCredential } = useCredentialPermissions()
  const canEditConnection =
    canManageCredential &&
    !credential.from_enterprise &&
    !credential.from_other_member &&
    !credential.not_allowed_to_use
  const providerApi = consoleQuery.workspaces.current.toolProvider.builtin.byProvider
  const params = { provider: pluginPayload.provider }
  const [connectionName, setConnectionName] = useState(credential.name)
  // Scope stays in the form draft until the update endpoint accepts visibility.
  const [connectionScope, setConnectionScope] = useState(
    credential.visibility || PermissionLevel.allTeamMembers,
  )
  // The API's is_default also marks a fallback connection, so this is a save action, not a persisted flag.
  const [setWorkspaceDefault, setSetWorkspaceDefault] = useState(false)
  const showWorkspaceDefault = connectionScope !== PermissionLevel.onlyMe
  const shouldSetWorkspaceDefault = showWorkspaceDefault && setWorkspaceDefault
  const updateCredential = useMutation(providerApi.update.post.mutationOptions())
  const setDefaultCredential = useMutation(providerApi.defaultCredential.post.mutationOptions())
  const isSavingConnection = updateCredential.isPending || setDefaultCredential.isPending
  const connectionSaveFailed = updateCredential.isError || setDefaultCredential.isError
  const connectionScopeLabel =
    connectionScope === PermissionLevel.onlyMe
      ? t(($) => $['form.permissionsOnlyMe'], { ns: 'datasetSettings' })
      : connectionScope === PermissionLevel.allTeamMembers
        ? t(($) => $['auth.connection.allWorkspaceMembers'], { ns: 'plugin' })
        : connectionScope === PermissionLevel.partialMembers
          ? t(($) => $['form.permissionsInvitedMembers'], { ns: 'datasetSettings' })
          : t(($) => $['auth.unavailable'], { ns: 'plugin' })
  const scopeOptions = [
    ...(connectionScope !== PermissionLevel.onlyMe &&
    connectionScope !== PermissionLevel.allTeamMembers
      ? [{ value: connectionScope, label: connectionScopeLabel, icon: 'i-ri-user-community-line' }]
      : []),
    {
      value: PermissionLevel.onlyMe,
      label: t(($) => $['form.permissionsOnlyMe'], { ns: 'datasetSettings' }),
      icon: 'i-ri-user-line',
    },
    {
      value: PermissionLevel.allTeamMembers,
      label: t(($) => $['auth.connection.allWorkspaceMembers'], { ns: 'plugin' }),
      icon: 'i-ri-user-community-line',
    },
  ]

  const saveConnection = async () => {
    if (!canEditConnection || !connectionName.trim() || isSavingConnection) return
    if (shouldSetWorkspaceDefault && !canUseCredential) return
    setDefaultCredential.reset()
    try {
      // A retry after setting the default fails only needs to finish the remaining step.
      if (
        !updateCredential.isSuccess ||
        updateCredential.variables.body.credential_id !== credential.id ||
        updateCredential.variables.body.name !== connectionName.trim()
      ) {
        await updateCredential.mutateAsync({
          params,
          body: { credential_id: credential.id, name: connectionName.trim() },
        })
      }
      if (shouldSetWorkspaceDefault) {
        await setDefaultCredential.mutateAsync({ params, body: { id: credential.id } })
      }
      onOpenChange(false)
      toast.success(t(($) => $['api.actionSuccess'], { ns: 'common' }))
    } catch {
      // Mutation state keeps an accessible error and the draft available for another attempt.
    } finally {
      // Renaming can succeed even when the separate default-setting request fails.
      onUpdate()
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!isSavingConnection) onOpenChange(nextOpen)
      }}
      onOpenChangeComplete={(nextOpen) => {
        if (!nextOpen) onCloseComplete()
      }}
      disablePointerDismissal={isSavingConnection}
    >
      <DialogContent className="w-140">
        <form
          className="flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault()
            void saveConnection()
          }}
        >
          <DialogTitle className="title-xl-semi-bold text-text-primary">
            {providerName
              ? t(($) => $['auth.connection.saveWithProvider'], {
                  ns: 'plugin',
                  provider: providerName,
                })
              : t(($) => $['auth.connection.save'], { ns: 'plugin' })}
          </DialogTitle>
          <Field name="connectionName" className="gap-1.5">
            <FieldLabel className="system-sm-regular text-text-primary">
              {t(($) => $['auth.connection.name'], { ns: 'plugin' })}
              <span aria-hidden className="text-text-destructive">
                {' '}
                *
              </span>
            </FieldLabel>
            <Input
              className="h-8"
              value={connectionName}
              onValueChange={setConnectionName}
              disabled={isSavingConnection}
              required
              maxLength={30}
            />
            <FieldError match="valueMissing">
              {t(($) => $['errorMsg.fieldRequired'], {
                ns: 'common',
                field: t(($) => $['auth.connection.name'], { ns: 'plugin' }),
              })}
            </FieldError>
          </Field>
          <Select
            value={connectionScope}
            onValueChange={(scope) => {
              if (!scope) return
              setConnectionScope(scope)
              if (scope === PermissionLevel.onlyMe) setSetWorkspaceDefault(false)
            }}
            disabled={isSavingConnection || !canEditConnection}
          >
            <div className="flex flex-col gap-2">
              <SelectLabel className="system-md-semibold text-text-primary">
                {t(($) => $['auth.whoCanUse'], { ns: 'plugin' })}
              </SelectLabel>
              <SelectTrigger className="h-10 px-1 system-md-regular">
                <span className="flex items-center gap-0.5">
                  <span aria-hidden className="flex size-6 shrink-0 items-center justify-center">
                    <span
                      className={cn(
                        'size-5 text-text-secondary',
                        connectionScope === PermissionLevel.onlyMe
                          ? 'i-ri-user-line'
                          : 'i-ri-user-community-line',
                      )}
                    />
                  </span>
                  <span className="px-1">{connectionScopeLabel}</span>
                </span>
              </SelectTrigger>
            </div>
            <SelectContent>
              {scopeOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  <span aria-hidden className={cn('size-5 shrink-0', option.icon)} />
                  <SelectItemText>{option.label}</SelectItemText>
                  <SelectItemIndicator />
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {showWorkspaceDefault && (
            <Field>
              <FieldLabel className="flex cursor-pointer items-center gap-2 system-sm-regular text-text-primary">
                <Checkbox
                  checked={setWorkspaceDefault}
                  onCheckedChange={setSetWorkspaceDefault}
                  disabled={isSavingConnection || !canUseCredential}
                />
                {t(($) => $['auth.connection.setWorkspaceDefault'], { ns: 'plugin' })}
              </FieldLabel>
            </Field>
          )}
          {connectionSaveFailed && (
            <p role="alert" className="system-sm-regular text-text-destructive">
              {t(($) => $['api.actionFailed'], { ns: 'common' })}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <DialogClose
              render={
                <Button disabled={isSavingConnection}>
                  {t(($) => $['operation.cancel'], { ns: 'common' })}
                </Button>
              }
            />
            <Button
              type="submit"
              variant="primary"
              disabled={!canEditConnection || !connectionName.trim()}
              loading={isSavingConnection}
            >
              {shouldSetWorkspaceDefault
                ? t(($) => $['auth.connection.saveAsDefault'], { ns: 'plugin' })
                : t(($) => $['operation.save'], { ns: 'common' })}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export default EditConnectionModal
