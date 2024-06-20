'use client'
import type { FC } from 'react'
import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import cn from 'classnames'
import Drawer from '@/app/components/base/drawer-plus'
import Form from '@/app/components/header/account-setting/model-provider-page/model-modal/Form'
import { addDefaultValue, toolParametersToFormSchemas } from '@/app/components/tools/utils/to-form-schema'
import type { Collection, Tool } from '@/app/components/tools/types'
import { CollectionType } from '@/app/components/tools/types'
import { fetchBuiltInToolList, fetchCustomToolList, fetchModelToolList, fetchWorkflowToolList } from '@/service/tools'
import I18n from '@/context/i18n'
import Button from '@/app/components/base/button'
import Loading from '@/app/components/base/loading'
import { DiagonalDividingLine } from '@/app/components/base/icons/src/public/common'
import { getLanguage } from '@/i18n/language'
import AppIcon from '@/app/components/base/app-icon'

type Props = {
  collection: Collection
  isBuiltIn?: boolean
  isModel?: boolean
  toolName: string
  setting?: Record<string, any>
  readonly?: boolean
  onHide: () => void
  onSave?: (value: Record<string, any>) => void
}

const SettingBuiltInTool: FC<Props> = ({
  collection,
  isBuiltIn = true,
  isModel = true,
  toolName,
  setting = {},
  readonly,
  onHide,
  onSave,
}) => {
  const { locale } = useContext(I18n)
  const language = getLanguage(locale)
  const { t } = useTranslation()

  const [isLoading, setIsLoading] = useState(true)
  const [tools, setTools] = useState<Tool[]>([])
  const currTool = tools.find(tool => tool.name === toolName)
  const formSchemas = currTool ? toolParametersToFormSchemas(currTool.parameters) : []
  const infoSchemas = formSchemas.filter((item: any) => item.form === 'llm')
  const settingSchemas = formSchemas.filter((item: any) => item.form !== 'llm')
  const hasSetting = settingSchemas.length > 0
  const [tempSetting, setTempSetting] = useState(setting)
  const [currType, setCurrType] = useState('info')
  const isInfoActive = currType === 'info'
  useEffect(() => {
    if (!collection)
      return

    (async () => {
      setIsLoading(true)
      try {
        const list = await new Promise<Tool[]>((resolve) => {
          (async function () {
            if (isModel)
              resolve(await fetchModelToolList(collection.name))
            else if (isBuiltIn)
              resolve(await fetchBuiltInToolList(collection.name))
            else if (collection.type === CollectionType.workflow)
              resolve(await fetchWorkflowToolList(collection.id))
            else
              resolve(await fetchCustomToolList(collection.name))
          }())
        })
        setTools(list)
        const currTool = list.find(tool => tool.name === toolName)
        if (currTool) {
          const formSchemas = toolParametersToFormSchemas(currTool.parameters)
          setTempSetting(addDefaultValue(setting, formSchemas))
        }
      }
      catch (e) { }
      setIsLoading(false)
    })()
  }, [collection?.name, collection?.id, collection?.type])

  useEffect(() => {
    setCurrType((!readonly && hasSetting) ? 'setting' : 'info')
  }, [hasSetting])

  const isValid = (() => {
    let valid = true
    settingSchemas.forEach((item: any) => {
      if (item.required && !tempSetting[item.name])
        valid = false
    })
    return valid
  })()

  const infoUI = (
    <div className='pt-2'>
      <div className='leading-5 text-sm font-medium text-gray-900'>
        {t('tools.setBuiltInTools.toolDescription')}
      </div>
      <div className='mt-1 leading-[18px] text-xs font-normal text-gray-600'>
        {currTool?.description[language]}
      </div>

      {infoSchemas.length > 0 && (
        <div className='mt-6'>
          <div className='flex items-center mb-4 leading-[18px] text-xs font-semibold text-gray-500 uppercase'>
            <div className='mr-3'>{t('tools.setBuiltInTools.parameters')}</div>
            <div className='grow w-0 h-px bg-[#f3f4f6]'></div>
          </div>
          <div className='space-y-4'>
            {infoSchemas.map((item: any, index) => (
              <div key={index}>
                <div className='flex items-center space-x-2 leading-[18px]'>
                  <div className='text-[13px] font-semibold text-gray-900'>{item.label[language]}</div>
                  <div className='text-xs font-medium text-gray-500'>{item.type === 'number-input' ? t('tools.setBuiltInTools.number') : t('tools.setBuiltInTools.string')}</div>
                  {item.required && (
                    <div className='text-xs font-medium text-[#EC4A0A]'>{t('tools.setBuiltInTools.required')}</div>
                  )}
                </div>
                {item.human_description && (
                  <div className='mt-1 leading-[18px] text-xs font-normal text-gray-600'>
                    {item.human_description?.[language]}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )

  const settingUI = (
    <Form
      value={tempSetting}
      onChange={setTempSetting}
      formSchemas={settingSchemas as any}
      isEditMode={false}
      showOnVariableMap={{}}
      validating={false}
      inputClassName='!bg-gray-50'
      readonly={readonly}
    />
  )

  return (
    <Drawer
      isShow
      onHide={onHide}
      title={(
        <div className='flex items-center'>
          {typeof collection.icon === 'string'
            ? (
              <div
                className='w-6 h-6 bg-cover bg-center rounded-md flex-shrink-0'
                style={{
                  backgroundImage: `url(${collection.icon})`,
                }}
              ></div>
            )
            : (
              <AppIcon
                className='rounded-md'
                size='tiny'
                icon={(collection.icon as any)?.content}
                background={(collection.icon as any)?.background}
              />
            )}

          <div className='ml-2 leading-6 text-base font-semibold text-gray-900'>{currTool?.label[language]}</div>
          {(hasSetting && !readonly) && (<>
            <DiagonalDividingLine className='mx-4' />
            <div className='flex space-x-6'>
              <div
                className={cn(isInfoActive ? 'text-gray-900 font-semibold' : 'font-normal text-gray-600 cursor-pointer', 'relative text-base')}
                onClick={() => setCurrType('info')}
              >
                {t('tools.setBuiltInTools.info')}
                {isInfoActive && <div className='absolute left-0 bottom-[-16px] w-full h-0.5 bg-primary-600'></div>}
              </div>
              <div className={cn(!isInfoActive ? 'text-gray-900 font-semibold' : 'font-normal text-gray-600 cursor-pointer', 'relative text-base ')}
                onClick={() => setCurrType('setting')}
              >
                {t('tools.setBuiltInTools.setting')}
                {!isInfoActive && <div className='absolute left-0 bottom-[-16px] w-full h-0.5 bg-primary-600'></div>}
              </div>
            </div>
          </>)}
        </div>
      )}
      panelClassName='mt-[65px] !w-[405px]'
      maxWidthClassName='!max-w-[405px]'
      height='calc(100vh - 65px)'
      headerClassName='!border-b-black/5'
      body={
        <div className='h-full pt-3'>
          {isLoading
            ? <div className='flex h-full items-center'>
              <Loading type='app' />
            </div>
            : (<div className='flex flex-col h-full'>
              <div className='grow h-0 overflow-y-auto  px-6'>
                {isInfoActive ? infoUI : settingUI}
              </div>
              {!readonly && !isInfoActive && (
                <div className='mt-2 shrink-0 flex justify-end py-4 px-6  space-x-2 rounded-b-[10px] bg-gray-50 border-t border-black/5'>
                  <Button className='flex items-center h-8 !px-3 !text-[13px] font-medium !text-gray-700' onClick={onHide}>{t('common.operation.cancel')}</Button>
                  <Button className='flex items-center h-8 !px-3 !text-[13px] font-medium' variant='primary' disabled={!isValid} onClick={() => onSave?.(addDefaultValue(tempSetting, formSchemas))}>{t('common.operation.save')}</Button>
                </div>
              )}
            </div>)}
        </div>
      }
      isShowMask={false}
      clickOutsideNotOpen={false}
    />
  )
}
export default React.memo(SettingBuiltInTool)
