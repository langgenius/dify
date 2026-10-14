import type { ApiKeyModalDataSource } from '../authorize/api-key-modal'
import type { ConnectionActionsDataSource } from '../connections/connection-actions'
import type { PluginPayload } from '../types'
import type { FormSchema } from '@/app/components/base/form/types'
import { skipToken, useMutation, useQuery } from '@tanstack/react-query'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
import { useCredentialPermissions } from '@/hooks/use-credential-permissions'
import { useRenderI18nObject } from '@/hooks/use-i18n'
import { consoleQuery } from '@/service/console'
import { CredentialTypeEnum } from '../types'

type WorkspaceConnectionOperationsProps = {
  pluginPayload: PluginPayload
  canApiKey: boolean
  onUpdate: () => void
}

export const useWorkspaceConnectionOperations = ({
  pluginPayload,
  canApiKey,
  onUpdate,
}: WorkspaceConnectionOperationsProps): {
  apiKey: ApiKeyModalDataSource
  connectionActions: ConnectionActionsDataSource
} => {
  const { t } = useTranslation(['common'])
  const renderI18nObject = useRenderI18nObject()
  const { canUseCredential, canManageCredential } = useCredentialPermissions()
  const providerApi = consoleQuery.workspaces.current.toolProvider.builtin.byProvider
  const params = { provider: pluginPayload.provider }
  const schema = useQuery(
    providerApi.credential.schema.byCredentialType.get.queryOptions({
      input: canApiKey
        ? { params: { ...params, credential_type: CredentialTypeEnum.API_KEY } }
        : skipToken,
    }),
  )
  const addCredential = useMutation(providerApi.add.post.mutationOptions())
  const updateApiKey = useMutation(providerApi.update.post.mutationOptions())
  const renameCredential = useMutation(providerApi.update.post.mutationOptions())
  const setDefaultCredential = useMutation(providerApi.defaultCredential.post.mutationOptions())
  const deleteCredential = useMutation(providerApi.delete.post.mutationOptions())
  // Keep only a successful rename whose separate default-setting request still needs a retry.
  const pendingDefaultRenameRef = useRef<{ id: string; name: string } | undefined>(undefined)
  const schemas: FormSchema[] = (schema.data ?? []).map((field) => ({
    ...field,
    label: field.label ? renderI18nObject(field.label) : field.name,
    required: !!field.required,
    help: field.help ? renderI18nObject(field.help) : undefined,
    placeholder: field.placeholder ? renderI18nObject(field.placeholder) : undefined,
    scope: field.scope ?? undefined,
    url: field.url ?? undefined,
    options: field.options?.map((option) => ({ ...option, label: renderI18nObject(option.label) })),
  }))
  const apiKey: ApiKeyModalDataSource = {
    schemas,
    isLoading: schema.isLoading,
    save: async ({ name, credentialId, credentials, visibility }) => {
      if (credentialId !== undefined) {
        await updateApiKey.mutateAsync({
          params,
          body: { credentials, credential_id: credentialId, name },
        })
      } else {
        await addCredential.mutateAsync({
          params,
          body: { credentials, type: CredentialTypeEnum.API_KEY, name, visibility },
        })
      }
      onUpdate()
    },
  }
  const canManageConnection: ConnectionActionsDataSource['canManageConnection'] = (credential) =>
    canManageCredential && !credential.from_enterprise && !credential.from_other_member
  return {
    apiKey,
    connectionActions: {
      apiKey,
      canManageConnection,
      canEditConnection: (credential) =>
        canManageConnection(credential) && !credential.not_allowed_to_use,
      remove: async (credential) => {
        await deleteCredential.mutateAsync({ params, body: { credential_id: credential.id } })
        toast.success(t(($) => $['api.actionSuccess'], { ns: 'common' }))
        onUpdate()
      },
      edit: {
        canEdit: canManageCredential,
        canUse: canUseCredential,
        resetSession: () => {
          pendingDefaultRenameRef.current = undefined
        },
        save: async ({ credential, name, setDefault }) => {
          try {
            if (
              pendingDefaultRenameRef.current?.id !== credential.id ||
              pendingDefaultRenameRef.current.name !== name
            ) {
              await renameCredential.mutateAsync({
                params,
                body: { credential_id: credential.id, name },
              })
              pendingDefaultRenameRef.current = { id: credential.id, name }
            }
            if (setDefault) {
              await setDefaultCredential.mutateAsync({ params, body: { id: credential.id } })
            }
            pendingDefaultRenameRef.current = undefined
            toast.success(t(($) => $['api.actionSuccess'], { ns: 'common' }))
          } finally {
            // A rename can succeed even when setting the default connection fails.
            onUpdate()
          }
        },
      },
    },
  }
}
