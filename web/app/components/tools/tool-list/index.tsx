'use client'
import type { FC } from 'react'
import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import cn from 'classnames'
import { AuthHeaderPrefix, AuthType, CollectionType, LOC } from '../types'
import type { Collection, CustomCollectionBackend, Tool } from '../types'
import Loading from '../../base/loading'
import { ArrowNarrowRight } from '../../base/icons/src/vender/line/arrows'
import Toast from '../../base/toast'
import { ConfigurateMethodEnum } from '../../header/account-setting/model-provider-page/declarations'
import Header from './header'
import Item from './item'
import AppIcon from '@/app/components/base/app-icon'
import ConfigCredential from '@/app/components/tools/setting/build-in/config-credentials'
import { fetchCustomCollection, removeBuiltInToolCredential, removeCustomCollection, updateBuiltInToolCredential, updateCustomCollection } from '@/service/tools'
import EditCustomToolModal from '@/app/components/tools/edit-custom-collection-modal'
import type { AgentTool } from '@/types/app'
import { MAX_TOOLS_NUM } from '@/config'
import { useModalContext } from '@/context/modal-context'
import { useProviderContext } from '@/context/provider-context'

type Props = {
  collection: Collection | null
  list: Tool[]
  // onToolListChange: () => void // custom tools change
  loc: LOC
  addedTools?: AgentTool[]
  onAddTool?: (collection: Collection, payload: Tool) => void
  onRefreshData: () => void
  onCollectionRemoved: () => void
  isLoading: boolean
}

const ToolList: FC<Props> = ({
  collection,
  list,
  loc,
  addedTools,
  onAddTool,
  onRefreshData,
  onCollectionRemoved,
  isLoading,
}) => {
  const { t } = useTranslation()
  const isInToolsPage = loc === LOC.tools
  const isBuiltIn = collection?.type === CollectionType.builtIn
  const isModel = collection?.type === CollectionType.model
  const needAuth = collection?.allow_delete

  const { setShowModelModal } = useModalContext()
  const [showSettingAuth, setShowSettingAuth] = useState(false)
  const { modelProviders: providers } = useProviderContext()
  const showSettingAuthModal = () => {
    if (isModel) {
      const provider = providers.find(item => item.provider === collection?.id)
      if (provider) {
        setShowModelModal({
          payload: {
            currentProvider: provider,
            currentConfigurateMethod: ConfigurateMethodEnum.predefinedModel,
            currentCustomConfigrationModelFixedFields: undefined,
          },
          onSaveCallback: () => {
            onRefreshData()
          },
        })
      }
    }
    else {
      setShowSettingAuth(true)
    }
  }

  const [customCollection, setCustomCollection] = useState<CustomCollectionBackend | null>(null)
  useEffect(() => {
    if (!collection)
      return
    (async () => {
      if (collection.type === CollectionType.custom) {
        const res = await fetchCustomCollection(collection.name)
        if (res.credentials.auth_type === AuthType.apiKey && !res.credentials.api_key_header_prefix) {
          if (res.credentials.api_key_value)
            res.credentials.api_key_header_prefix = AuthHeaderPrefix.custom
        }
        setCustomCollection({
          ...res,
          provider: collection.name,
        })
      }
    })()
  }, [collection])
  const [isShowEditCollectionToolModal, setIsShowEditCustomCollectionModal] = useState(false)

  const doUpdateCustomToolCollection = async (data: CustomCollectionBackend) => {
    await updateCustomCollection(data)
    onRefreshData()
    Toast.notify({
      type: 'success',
      message: t('common.api.actionSuccess'),
    })
    setIsShowEditCustomCollectionModal(false)
  }

  const doRemoveCustomToolCollection = async () => {
    await removeCustomCollection(collection?.name as string)
    onCollectionRemoved()
    Toast.notify({
      type: 'success',
      message: t('common.api.actionSuccess'),
    })
    setIsShowEditCustomCollectionModal(false)
  }

  if (!collection || isLoading)
    return <Loading type='app' />

  const icon = <>{typeof collection.icon === 'string'
    ? (
      <div
        className='p-2 bg-cover bg-center border border-gray-100 rounded-lg'
      >
        <div className='w-6 h-6 bg-center bg-contain rounded-md'
          style={{
            backgroundImage: `url(${collection.icon})`,
          }}
        ></div>
      </div>
    )
    : (
      <AppIcon
        size='large'
        icon={collection.icon.content}
        background={collection.icon.background}
      />
    )}
  </>

  return (
    <div className='flex flex-col h-full pb-4'>
      <Header
        icon={icon}
        collection={collection}
        loc={loc}
        onShowAuth={() => showSettingAuthModal()}
        onShowEditCustomCollection={() => setIsShowEditCustomCollectionModal(true)}
      />
      <div className={cn(isInToolsPage ? 'px-6 pt-4' : 'px-4 pt-3')}>
        <div className='flex items-center h-[4.5] space-x-2  text-xs font-medium text-gray-500'>
          <div className=''>{t('tools.includeToolNum', {
            num: list.length,
          })}</div>
          {needAuth && (isBuiltIn || isModel) && !collection.is_team_authorization && (
            <>
              <div>·</div>
              <div
                className='flex items-center text-[#155EEF] cursor-pointer'
                onClick={() => showSettingAuthModal()}
              >
                <div>{t('tools.auth.setup')}</div>
                <ArrowNarrowRight className='ml-0.5 w-3 h-3' />
              </div>
            </>
          )}
        </div>
      </div>
      <div className={cn(isInToolsPage ? 'px-6' : 'px-4', 'grow h-0 pt-2 overflow-y-auto')}>
        {/* list */}
        <div className={cn(isInToolsPage ? 'grid-cols-3 gap-4' : 'grid-cols-1 gap-2', 'grid')}>
          {list.map(item => (
            <Item
              key={item.name}
              icon={icon}
              payload={item}
              collection={collection}
              isInToolsPage={isInToolsPage}
              isToolNumMax={(addedTools?.length || 0) >= MAX_TOOLS_NUM}
              added={!!addedTools?.find(v => v.provider_id === collection.id && v.provider_type === collection.type && v.tool_name === item.name)}
              onAdd={!isInToolsPage ? tool => onAddTool?.(collection as Collection, tool) : undefined}
            />
          ))}
        </div>
      </div>
      {showSettingAuth && (
        <ConfigCredential
          collection={collection}
          onCancel={() => setShowSettingAuth(false)}
          onSaved={async (value) => {
            await updateBuiltInToolCredential(collection.name, value)
            Toast.notify({
              type: 'success',
              message: t('common.api.actionSuccess'),
            })
            await onRefreshData()
            setShowSettingAuth(false)
          }}
          onRemove={async () => {
            await removeBuiltInToolCredential(collection.name)
            Toast.notify({
              type: 'success',
              message: t('common.api.actionSuccess'),
            })
            await onRefreshData()
            setShowSettingAuth(false)
          }}
        />
      )}

      {isShowEditCollectionToolModal && (
        <EditCustomToolModal
          payload={customCollection}
          onHide={() => setIsShowEditCustomCollectionModal(false)}
          onEdit={doUpdateCustomToolCollection}
          onRemove={doRemoveCustomToolCollection}
        />
      )}
    </div>
  )
}
export default React.memo(ToolList)
