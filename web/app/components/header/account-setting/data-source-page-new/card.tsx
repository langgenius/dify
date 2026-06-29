import type {
  DataSourceAuth,
  DataSourceCredential,
} from './types'
import type { PluginDetail } from '@/app/components/plugins/types'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import {
  memo,
  useCallback,
  useRef,
} from 'react'
import { useTranslation } from '#i18n'
import Badge from '@/app/components/base/badge'
import {
  ApiKeyModal,
  usePluginAuthAction,
} from '@/app/components/plugins/plugin-auth'
import { AuthCategory } from '@/app/components/plugins/plugin-auth/types'
import { CollectionType } from '@/app/components/tools/types'
import { useCredentialPermissions } from '@/hooks/use-credential-permissions'
import { useRenderI18nObject } from '@/hooks/use-i18n'
import { openOAuthPopup } from '@/hooks/use-oauth'
import { useGetDataSourceOAuthUrl } from '@/service/use-datasource'
import Configure from './configure'
import { useDataSourceAuthUpdate } from './hooks'
import Item from './item'
import DataSourcePluginActions from './plugin-actions'

const getPluginVersion = (uniqueIdentifier?: string) => {
  return uniqueIdentifier?.match(/:([^:@]+)@/)?.[1]
}

type CardProps = {
  item: DataSourceAuth
  disabled?: boolean
  pluginDetail?: PluginDetail
  onPluginUpdate?: (isDelete?: boolean) => void
}
const Card = ({
  item,
  disabled,
  pluginDetail,
  onPluginUpdate,
}: CardProps) => {
  const { t } = useTranslation()
  const { canUseCredential, canCreateCredential, canManageCredential } = useCredentialPermissions()
  const renderI18nObject = useRenderI18nObject()
  const {
    icon,
    label,
    credentials_list,
    credential_schema,
  } = item
  const providerLabel = renderI18nObject(label)
  const fallbackPluginVersion = getPluginVersion(item.plugin_unique_identifier)
  const pluginPayload = {
    category: AuthCategory.datasource,
    provider: `${item.plugin_id}/${item.name}`,
    providerType: CollectionType.datasource,
  }
  const { handleAuthUpdate } = useDataSourceAuthUpdate({
    pluginId: item.plugin_id,
    provider: item.name,
  })
  const {
    deleteCredentialId,
    doingAction,
    handleConfirm,
    handleEdit,
    handleRemove,
    handleRename,
    handleSetDefault,
    editValues,
    setEditValues,
    openConfirm,
    closeConfirm,
    pendingOperationCredentialId,
  } = usePluginAuthAction(pluginPayload, handleAuthUpdate)
  const changeCredentialIdRef = useRef<string | undefined>(undefined)
  const {
    mutateAsync: getPluginOAuthUrl,
  } = useGetDataSourceOAuthUrl(pluginPayload.provider)
  const handleOAuth = useCallback(async () => {
    const { authorization_url } = await getPluginOAuthUrl(changeCredentialIdRef.current)

    if (authorization_url) {
      openOAuthPopup(
        authorization_url,
        handleAuthUpdate,
      )
    }
  }, [getPluginOAuthUrl, handleAuthUpdate])
  const handleAction = useCallback((
    action: string,
    credentialItem: DataSourceCredential,
    renamePayload?: { credential_id: string, name: string },
  ) => {
    if (action === 'edit') {
      handleEdit(
        credentialItem.id,
        {
          ...credentialItem.credential,
          __name__: credentialItem.name,
          __credential_id__: credentialItem.id,
        },
      )
    }
    if (action === 'delete')
      openConfirm(credentialItem.id)

    if (action === 'setDefault')
      handleSetDefault(credentialItem.id)

    if (action === 'rename' && renamePayload)
      handleRename(renamePayload)

    if (action === 'change') {
      changeCredentialIdRef.current = credentialItem.id
      handleOAuth()
    }
  }, [
    openConfirm,
    handleEdit,
    handleSetDefault,
    handleRename,
    handleOAuth,
  ])

  return (
    <div className="rounded-xl bg-background-section-burn">
      <div className="flex items-center gap-3 overflow-hidden px-3 pt-3 pb-2">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg border-[0.5px] border-divider-regular bg-text-primary-on-surface p-1 shadow-xs backdrop-blur-sm">
          <img
            src={icon}
            alt={providerLabel}
            width={20}
            height={20}
            className="h-5 w-5 object-contain"
          />
        </div>
        <div className="flex min-w-0 grow items-center gap-2">
          <div className="truncate system-md-medium text-text-primary">
            {providerLabel}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {
              pluginDetail
                ? (
                    <DataSourcePluginActions
                      detail={pluginDetail}
                      onUpdate={onPluginUpdate}
                    />
                  )
                : !!fallbackPluginVersion && (
                    <Badge
                      className="h-5 px-1.5"
                      text={(
                        <>
                          <div>{fallbackPluginVersion}</div>
                          <span aria-hidden className="ml-1 i-ri-arrow-left-right-line h-3 w-3 shrink-0 text-text-tertiary" />
                        </>
                      )}
                      uppercase={false}
                    />
                  )
            }
          </div>
        </div>
        <div onClick={e => e.stopPropagation()}>
          <Configure
            pluginPayload={pluginPayload}
            item={item}
            onUpdate={handleAuthUpdate}
            disabled={disabled || !canCreateCredential}
          />
        </div>
      </div>
      <div className="flex h-4 items-center pl-3 system-xs-medium text-text-tertiary">
        {t('auth.connectedWorkspace', { ns: 'plugin' })}
        <div className="ml-3 h-px grow bg-divider-subtle"></div>
      </div>
      {
        !!credentials_list.length && (
          <div className="space-y-1 p-3 pt-2" onClick={e => e.stopPropagation()}>
            {
              credentials_list.map(credentialItem => (
                <Item
                  key={credentialItem.id}
                  credentialItem={credentialItem}
                  onAction={handleAction}
                  canUseCredential={canUseCredential}
                  canManageCredential={canManageCredential}
                />
              ))
            }
          </div>
        )
      }
      {
        !credentials_list.length && (
          <div className="p-3 pt-1">
            <div className="flex h-10 items-center justify-center rounded-[10px] bg-background-section system-xs-regular text-text-tertiary">
              {t('auth.emptyAuth', { ns: 'plugin' })}
            </div>
          </div>
        )
      }
      <AlertDialog open={!!deleteCredentialId} onOpenChange={open => !open && closeConfirm()}>
        <AlertDialogContent>
          <div className="flex flex-col gap-2 px-6 pt-6 pb-4">
            <AlertDialogTitle className="w-full truncate title-2xl-semi-bold text-text-primary">
              {t('list.delete.title', { ns: 'datasetDocuments' })}
            </AlertDialogTitle>
          </div>
          <AlertDialogActions>
            <AlertDialogCancelButton>{t('operation.cancel', { ns: 'common' })}</AlertDialogCancelButton>
            <AlertDialogConfirmButton disabled={doingAction || !canManageCredential} onClick={handleConfirm}>
              {t('operation.confirm', { ns: 'common' })}
            </AlertDialogConfirmButton>
          </AlertDialogActions>
        </AlertDialogContent>
      </AlertDialog>
      {
        !!editValues && (
          <ApiKeyModal
            pluginPayload={pluginPayload}
            onClose={() => {
              setEditValues(null)
              pendingOperationCredentialId.current = null
            }}
            onUpdate={handleAuthUpdate}
            formSchemas={credential_schema}
            editValues={editValues}
            onRemove={handleRemove}
            disabled={disabled || doingAction || !canManageCredential}
          />
        )
      }
    </div>
  )
}

export default memo(Card)
