'use client'
import React, { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import cn from 'classnames'
import { CollectionType } from '../types'
import type { Collection, Tool } from '../types'
import ToolItem from './tool-item'
import I18n from '@/context/i18n'
import { getLanguage } from '@/i18n/language'
import AppIcon from '@/app/components/base/app-icon'
import Button from '@/app/components/base/button'
import Indicator from '@/app/components/header/indicator'
import { Settings01 } from '@/app/components/base/icons/src/vender/line/general'
import ConfigCredential from '@/app/components/tools/setting/build-in/config-credentials'
import Toast from '@/app/components/base/toast'
import { fetchBuiltInToolList, fetchCustomToolList, fetchModelToolList, removeBuiltInToolCredential, updateBuiltInToolCredential } from '@/service/tools'
import { useModalContext } from '@/context/modal-context'
import { useProviderContext } from '@/context/provider-context'
import { ConfigurateMethodEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import Loading from '@/app/components/base/loading'

type Props = {
  collection: Collection
  onRefreshData: () => void
}

const ProviderDetail = ({
  collection,
  onRefreshData,
}: Props) => {
  const { t } = useTranslation()
  const { locale } = useContext(I18n)
  const language = getLanguage(locale)

  const needAuth = collection.allow_delete || collection.type === CollectionType.model
  const isAuthed = collection.is_team_authorization
  const isBuiltIn = collection.type === CollectionType.builtIn
  const isModel = collection.type === CollectionType.model

  const [showSettingAuth, setShowSettingAuth] = useState(false)
  const { setShowModelModal } = useModalContext()
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

  const [isDetailLoading, setIsDetailLoading] = useState(false)
  const [toolList, setToolList] = useState<Tool[]>([])
  const getProviderToolList = useCallback(async () => {
    setIsDetailLoading(true)
    try {
      if (collection.type === CollectionType.builtIn) {
        const list = await fetchBuiltInToolList(collection.name)
        setToolList(list)
      }
      else if (collection.type === CollectionType.model) {
        const list = await fetchModelToolList(collection.name)
        setToolList(list)
      }
      else {
        const list = await fetchCustomToolList(collection.name)
        setToolList(list)
      }
    }
    catch (e) { }
    setIsDetailLoading(false)
  }, [collection.name, collection.type])

  useEffect(() => {
    getProviderToolList()
  }, [collection.name, collection.type, getProviderToolList])

  return (
    <div className='px-6 py-3'>
      <div className='flex items-center py-1 gap-2'>
        <div className='relative shrink-0'>
          {typeof collection.icon === 'string' && (
            <div className='w-8 h-8 bg-center bg-cover bg-no-repeat rounded-md' style={{ backgroundImage: `url(${collection.icon})` }}/>
          )}
          {typeof collection.icon !== 'string' && (
            <AppIcon
              size='small'
              icon={collection.icon.content}
              background={collection.icon.background}
            />
          )}
        </div>
        <div className='grow w-0 py-[1px]'>
          <div className='flex items-center text-md leading-6 font-semibold text-gray-900'>
            <div className='truncate' title={collection.label[language]}>{collection.label[language]}</div>
          </div>
        </div>
      </div>
      <div className='mt-2 min-h-[36px] text-gray-500 text-sm leading-[18px]'>{collection.description[language]}</div>
      <div className='flex gap-1 border-b-[0.5px] border-black/5'>
        {(collection.type === CollectionType.builtIn || collection.type === CollectionType.model) && needAuth && (
          <Button
            type={isAuthed ? 'default' : 'primary'}
            className={cn('shrink-0 my-3 w-full flex items-center', isAuthed && 'bg-white')}
            onClick={() => {
              if (collection.type === CollectionType.builtIn || collection.type === CollectionType.model)
                showSettingAuthModal()
            }}
          >
            {isAuthed && <Indicator className='mr-2' color={'green'} />}
            <div className={cn('text-white leading-[18px] text-[13px] font-medium', isAuthed && '!text-gray-700')}>
              {isAuthed ? t('tools.auth.authorized') : t('tools.auth.unauthorized')}
            </div>
          </Button>
        )}
        {collection.type === CollectionType.custom && (
          <Button
            className={cn('shrink-0 my-3 w-full flex items-center bg-white')}
            // onClick={() => onShowEditCustomCollection()}
          >
            <Settings01 className='mr-1 w-4 h-4 text-gray-500' />
            <div className='leading-5 text-sm font-medium text-gray-700'>{t('tools.createTool.editAction')}</div>
          </Button>
        )}
      </div>
      <div className='pt-3'>
        {isDetailLoading && <div className='flex h-[200px]'><Loading type='app'/></div>}
        {!isDetailLoading && (
          <div className='text-xs font-medium leading-6 text-gray-500'>
            <span className=''>{t('tools.includeToolNum', { num: toolList.length }).toLocaleUpperCase()}</span>
            {needAuth && (isBuiltIn || isModel) && !isAuthed && (
              <>
                <span className='px-1'>·</span>
                <span className='text-[#DC6803]'>{t('tools.auth.setup').toLocaleUpperCase()}</span>
              </>
            )}
          </div>
        )}
        {!isDetailLoading && (
          <div className='mt-1'>
            {toolList.map(tool => (
              <ToolItem
                key={tool.name}
                disabled={needAuth && (isBuiltIn || isModel) && !isAuthed}
                collection={collection}
                tool={tool}
                isBuiltIn={isBuiltIn}
                isModel={isModel}
              />
            ))}
          </div>
        )}
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
    </div>
  )
}
export default ProviderDetail
