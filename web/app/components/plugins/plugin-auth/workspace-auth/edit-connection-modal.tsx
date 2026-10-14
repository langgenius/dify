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

export type EditConnectionDataSource = {
  canEdit: boolean
  canUse: boolean
  save: (args: {
    credential: Credential
    name: string
    visibility: string
    setDefault: boolean
  }) => Promise<void>
}

type EditConnectionModalCommonProps = {
  credential: Credential
  providerName?: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onCloseComplete: () => void
  onUpdate?: () => void
}

type EditConnectionModalProps = EditConnectionModalCommonProps &
  (
    | { pluginPayload: PluginPayload; onUpdate: () => void; dataSource?: undefined }
    | { dataSource: EditConnectionDataSource; pluginPayload?: PluginPayload }
  )

const EditConnectionContent = ({
  credential,
  providerName,
  open,
  onOpenChange,
  onCloseComplete,
  dataSource,
}: EditConnectionModalCommonProps & { dataSource: EditConnectionDataSource }) => {
  const { t } = useTranslation(['common', 'plugin', 'datasetSettings'])
  const canEditConnection = dataSource.canEdit
  const canUseCredential = dataSource.canUse
  const [connectionName, setConnectionName] = useState(credential.name)
  // Scope stays in the form draft until the update endpoint accepts visibility.
  const [connectionScope, setConnectionScope] = useState(
    credential.visibility || PermissionLevel.allTeamMembers,
  )
  // The API's is_default also marks a fallback connection, so this is a save action, not a persisted flag.
  const [setWorkspaceDefault, setSetWorkspaceDefault] = useState(false)
  const showWorkspaceDefault = connectionScope !== PermissionLevel.onlyMe
  const shouldSetWorkspaceDefault = showWorkspaceDefault && setWorkspaceDefault
  const [isSavingConnection, setIsSavingConnection] = useState(false)
  const [connectionSaveFailed, setConnectionSaveFailed] = useState(false)
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
    setIsSavingConnection(true)
    setConnectionSaveFailed(false)
    try {
      await dataSource.save({
        credential,
        name: connectionName.trim(),
        visibility: connectionScope,
        setDefault: shouldSetWorkspaceDefault,
      })
      onOpenChange(false)
    } catch {
      setConnectionSaveFailed(true)
    } finally {
      setIsSavingConnection(false)
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

const WorkspaceEditConnectionModal = (
  props: EditConnectionModalCommonProps & { pluginPayload: PluginPayload; onUpdate: () => void },
) => {
  const { credential, pluginPayload, onUpdate } = props
  const { t } = useTranslation(['common'])
  const { canUseCredential, canManageCredential } = useCredentialPermissions()
  const providerApi = consoleQuery.workspaces.current.toolProvider.builtin.byProvider
  const params = { provider: pluginPayload.provider }
  const updateCredential = useMutation(providerApi.update.post.mutationOptions())
  const setDefaultCredential = useMutation(providerApi.defaultCredential.post.mutationOptions())
  const dataSource: EditConnectionDataSource = {
    canEdit:
      canManageCredential &&
      !credential.from_enterprise &&
      !credential.from_other_member &&
      !credential.not_allowed_to_use,
    canUse: canUseCredential,
    save: async ({ credential, name, setDefault }) => {
      setDefaultCredential.reset()
      try {
        // Retry only the remaining default step when the same rename already succeeded.
        if (
          !updateCredential.isSuccess ||
          updateCredential.variables.body.credential_id !== credential.id ||
          updateCredential.variables.body.name !== name
        ) {
          await updateCredential.mutateAsync({
            params,
            body: { credential_id: credential.id, name },
          })
        }
        if (setDefault) {
          await setDefaultCredential.mutateAsync({ params, body: { id: credential.id } })
        }
        toast.success(t(($) => $['api.actionSuccess'], { ns: 'common' }))
      } finally {
        // Renaming can succeed even when the separate default-setting request fails.
        onUpdate()
      }
    },
  }
  return <EditConnectionContent {...props} dataSource={dataSource} />
}

const EditConnectionModal = (props: EditConnectionModalProps) =>
  props.dataSource ? (
    <EditConnectionContent {...props} dataSource={props.dataSource} />
  ) : (
    <WorkspaceEditConnectionModal {...props} />
  )

export default EditConnectionModal
