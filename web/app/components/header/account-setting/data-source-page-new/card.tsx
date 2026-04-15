import type {
  DataSourceAuth,
  DataSourceCredential,
} from './types'
import {
  memo,
  useCallback,
  useRef,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogTitle,
} from '@/app/components/base/ui/alert-dialog'
import {
  ApiKeyModal,
  usePluginAuthAction,
} from '@/app/components/plugins/plugin-auth'
import { AuthCategory } from '@/app/components/plugins/plugin-auth/types'
import { CollectionType } from '@/app/components/tools/types'
import { useRenderI18nObject } from '@/hooks/use-i18n'
import { openOAuthPopup } from '@/hooks/use-oauth'
import { useGetDataSourceOAuthUrl } from '@/service/use-datasource'
import Configure from './configure'
import { useDataSourceAuthUpdate } from './hooks'
import Item from './item'

type CardProps = {
  item: DataSourceAuth
  disabled?: boolean
}
const Card = ({
  item,
  disabled,
}: CardProps) => {
  const { t } = useTranslation()
  const renderI18nObject = useRenderI18nObject()
  const {
    icon,
    label,
    author,
    name,
    credentials_list,
    credential_schema,
  } = item
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
    renamePayload?: Record<string, any>,
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

    if (action === 'rename')
      handleRename(renamePayload as any)

    if (action === 'change') {
      changeCredentialIdRef.current = credentialItem.id
      handleOAuth()
    }
  }, [
    openConfirm,
    handleEdit,
    handleSetDefault,
    handleRename,
  ])

  return (
    <div className="rounded-xl bg-background-section-burn">
      <div className="flex items-center p-3 pb-2">
        <img
          src={icon}
          className="mr-3 flex h-10 w-10 shrink-0 items-center justify-center"
        />
        <div className="grow">
          <div className="system-md-semibold text-text-primary">
            {renderI18nObject(label)}
          </div>
          <div className="flex h-4 items-center system-xs-regular text-text-tertiary">
            {author}
            <div className="mx-0.5 text-text-quaternary">/</div>
            {name}
          </div>
        </div>
        <Configure
          pluginPayload={pluginPayload}
          item={item}
          onUpdate={handleAuthUpdate}
        />
      </div>
      <div className="flex h-4 items-center pl-3 system-xs-medium text-text-tertiary">
        {t('auth.connectedWorkspace', { ns: 'plugin' })}
        <div className="ml-3 h-px grow bg-divider-subtle"></div>
      </div>
      {
        !!credentials_list.length && (
          <div className="space-y-1 p-3 pt-2">
            {
              credentials_list.map(credentialItem => (
                <Item
                  key={credentialItem.id}
                  credentialItem={credentialItem}
                  onAction={handleAction}
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
            <AlertDialogConfirmButton disabled={doingAction} onClick={handleConfirm}>
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
            disabled={disabled || doingAction}
          />
        )
      }
    </div>
  )
}

export default memo(Card)
