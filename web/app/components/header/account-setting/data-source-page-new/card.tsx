import {
  memo,
  useCallback,
  useRef,
} from 'react'
import { useTranslation } from 'react-i18next'
import Item from './item'
import Configure from './configure'
import type {
  DataSourceAuth,
  DataSourceCredential,
} from './types'
import { useRenderI18nObject } from '@/hooks/use-i18n'
import { AuthCategory } from '@/app/components/plugins/plugin-auth/types'
import {
  ApiKeyModal,
  usePluginAuthAction,
} from '@/app/components/plugins/plugin-auth'
import { useDataSourceAuthUpdate } from './hooks'
import Confirm from '@/app/components/base/confirm'
import { useGetDataSourceOAuthUrl } from '@/service/use-datasource'
import { openOAuthPopup } from '@/hooks/use-oauth'

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
    <div className='rounded-xl bg-background-section-burn'>
      <div className='flex items-center p-3 pb-2'>
        <img
          src={icon}
          className='mr-3 flex h-10 w-10 shrink-0 items-center justify-center'
        />
        <div className='grow'>
          <div className='system-md-semibold text-text-primary'>
            {renderI18nObject(label)}
          </div>
          <div className='system-xs-regular flex h-4 items-center text-text-tertiary'>
            {author}
            <div className='mx-0.5 text-text-quaternary'>/</div>
            {name}
          </div>
        </div>
        <Configure
          pluginPayload={pluginPayload}
          item={item}
          onUpdate={handleAuthUpdate}
        />
      </div>
      <div className='system-xs-medium flex h-4 items-center pl-3 text-text-tertiary'>
        {t('plugin.auth.connectedWorkspace')}
        <div className='ml-3 h-[1px] grow bg-divider-subtle'></div>
      </div>
      {
        !!credentials_list.length && (
          <div className='space-y-1 p-3 pt-2'>
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
          <div className='p-3 pt-1'>
            <div className='system-xs-regular flex h-10 items-center justify-center rounded-[10px] bg-background-section text-text-tertiary'>
              {t('plugin.auth.emptyAuth')}
            </div>
          </div>
        )
      }
      {
        deleteCredentialId && (
          <Confirm
            isShow
            title={t('datasetDocuments.list.delete.title')}
            isDisabled={doingAction}
            onCancel={closeConfirm}
            onConfirm={handleConfirm}
          />
        )
      }
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
