import type { DropdownMenuHandle } from '@langgenius/dify-ui/dropdown-menu'
import type { Credential, PluginPayload } from '../types'
import {
  AlertDialog,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useMutation } from '@tanstack/react-query'
import { memo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
import { useCredentialPermissions } from '@/hooks/use-credential-permissions'
import { consoleQuery } from '@/service/console'
import ApiKeyModal from '../authorize/api-key-modal'
import { CredentialTypeEnum } from '../types'
import EditConnectionModal from './edit-connection-modal'

type ConnectionActionsTriggerProps = {
  handle: DropdownMenuHandle<Credential>
  credential: Credential
}

export const ConnectionActionsTrigger = ({ handle, credential }: ConnectionActionsTriggerProps) => {
  const { t } = useTranslation(['common'])
  const { canManageCredential } = useCredentialPermissions()
  if (!canManageCredential || credential.from_enterprise || credential.from_other_member)
    return null

  return (
    <DropdownMenuTrigger
      handle={handle}
      payload={credential}
      render={
        <IconButton
          size="xs"
          aria-label={t(($) => $['operation.moreActionsFor'], { name: credential.name })}
        >
          <span aria-hidden className="i-ri-more-fill size-4 text-text-tertiary" />
        </IconButton>
      }
    />
  )
}

type ConnectionActionsProps = {
  handle: DropdownMenuHandle<Credential>
  pluginPayload: PluginPayload
  providerName?: string
  onAction: () => void
  onUpdate: () => void
}

const ConnectionActions = ({
  handle,
  pluginPayload,
  providerName,
  onAction,
  onUpdate,
}: ConnectionActionsProps) => {
  const { t } = useTranslation(['common', 'plugin', 'datasetDocuments'])
  const { canManageCredential } = useCredentialPermissions()
  const providerApi = consoleQuery.workspaces.current.toolProvider.builtin.byProvider
  const params = { provider: pluginPayload.provider }
  const canManageConnection = (credential: Credential) =>
    canManageCredential && !credential.from_enterprise && !credential.from_other_member
  const canEditConnection = (credential: Credential) =>
    canManageConnection(credential) && !credential.not_allowed_to_use
  const [editingCredential, setEditingCredential] = useState<Credential | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [deleteCredential, setDeleteCredential] = useState<Credential | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [replacementCredential, setReplacementCredential] = useState<Credential | null>(null)
  const [replacementOpen, setReplacementOpen] = useState(false)
  const removeCredential = useMutation(
    providerApi.delete.post.mutationOptions({
      onSuccess: () => {
        onUpdate()
        setDeleteOpen(false)
        toast.success(t(($) => $['api.actionSuccess'], { ns: 'common' }))
      },
    }),
  )
  const editConnection = (credential: Credential) => {
    if (!canEditConnection(credential)) return
    onAction()
    setEditingCredential(credential)
    setEditOpen(true)
  }
  const replaceApiKey = (credential: Credential) => {
    if (!canEditConnection(credential) || credential.credential_type !== CredentialTypeEnum.API_KEY)
      return
    onAction()
    setReplacementCredential(credential)
    setReplacementOpen(true)
  }
  const requestRemoval = (credential: Credential) => {
    if (!canManageConnection(credential)) return
    onAction()
    setDeleteCredential(credential)
    setDeleteOpen(true)
  }

  return (
    <>
      <DropdownMenu handle={handle}>
        {({ payload }) => {
          if (!payload || !canManageConnection(payload)) return null
          const canEdit = canEditConnection(payload)
          return (
            <DropdownMenuContent placement="bottom-end" className="w-56 max-w-(--available-width)">
              <DropdownMenuItem
                className="h-auto min-h-8"
                disabled={!canEdit}
                onClick={() => editConnection(payload)}
              >
                <span className="px-1 py-0.5 system-md-regular">
                  {t(($) => $['auth.connection.edit'], { ns: 'plugin' })}
                </span>
              </DropdownMenuItem>
              {payload.credential_type === CredentialTypeEnum.OAUTH2 ? (
                <Tooltip>
                  <TooltipTrigger render={<div />}>
                    <DropdownMenuItem
                      className="h-auto min-h-8"
                      disabled
                      aria-description={t(($) => $['auth.connection.reauthorizeUnavailable'], {
                        ns: 'plugin',
                      })}
                    >
                      <span className="px-1 py-0.5 system-md-regular">
                        {t(($) => $['auth.connection.reauthorize'], { ns: 'plugin' })}
                      </span>
                    </DropdownMenuItem>
                  </TooltipTrigger>
                  <TooltipContent role="tooltip">
                    {t(($) => $['auth.connection.reauthorizeUnavailable'], { ns: 'plugin' })}
                  </TooltipContent>
                </Tooltip>
              ) : (
                <DropdownMenuItem
                  className="h-auto min-h-8"
                  disabled={!canEdit}
                  onClick={() => replaceApiKey(payload)}
                >
                  <span className="px-1 py-0.5 system-md-regular">
                    {t(($) => $['auth.connection.replaceApiKey'], { ns: 'plugin' })}
                  </span>
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                className="h-auto min-h-8"
                variant="destructive"
                onClick={() => requestRemoval(payload)}
              >
                <span className="px-1 py-0.5 system-md-regular">
                  {t(($) => $['operation.remove'], { ns: 'common' })}
                </span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          )
        }}
      </DropdownMenu>
      {editingCredential && (
        <EditConnectionModal
          key={editingCredential.id}
          credential={editingCredential}
          pluginPayload={pluginPayload}
          providerName={providerName}
          open={editOpen}
          onOpenChange={setEditOpen}
          onCloseComplete={() => setEditingCredential(null)}
          onUpdate={onUpdate}
        />
      )}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <div className="p-6 pb-0">
            <AlertDialogTitle className="title-lg-semi-bold text-text-primary">
              {t(($) => $['list.delete.title'], { ns: 'datasetDocuments' })}
            </AlertDialogTitle>
            <AlertDialogDescription className="mt-2 system-sm-regular text-text-secondary">
              {deleteCredential?.name}
            </AlertDialogDescription>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancelButton disabled={removeCredential.isPending}>
              {t(($) => $['operation.cancel'], { ns: 'common' })}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton
              loading={removeCredential.isPending}
              disabled={!deleteCredential || !canManageConnection(deleteCredential)}
              onClick={() => {
                if (
                  !deleteCredential ||
                  !canManageConnection(deleteCredential) ||
                  removeCredential.isPending
                )
                  return
                removeCredential.mutate({ params, body: { credential_id: deleteCredential.id } })
              }}
            >
              {t(($) => $['operation.confirm'], { ns: 'common' })}
            </AlertDialogConfirmButton>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {replacementCredential && (
        <ApiKeyModal
          open={replacementOpen}
          onOpenChange={setReplacementOpen}
          pluginPayload={pluginPayload}
          editValues={{
            ...replacementCredential.credentials,
            __name__: replacementCredential.name,
            __credential_id__: replacementCredential.id,
            __visibility__: replacementCredential.visibility,
          }}
          disabled={!canEditConnection(replacementCredential)}
          onUpdate={onUpdate}
          onRemove={() => {
            if (!canManageConnection(replacementCredential)) return
            setReplacementOpen(false)
            requestRemoval(replacementCredential)
          }}
        />
      )}
    </>
  )
}

export default memo(ConnectionActions)
