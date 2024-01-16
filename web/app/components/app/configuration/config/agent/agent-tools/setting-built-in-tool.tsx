'use client'
import type { FC } from 'react'
import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import Drawer from '@/app/components/base/drawer-plus'
import Form from '@/app/components/header/account-setting/model-provider-page/model-modal/Form'
import { addDefaultValue, toolParametersToFormSchemas } from '@/app/components/tools/utils/to-form-schema'
import type { Collection, Tool } from '@/app/components/tools/types'
import { fetchBuiltInToolList } from '@/service/tools'
import AppIcon from '@/app/components/base/app-icon'
import I18n from '@/context/i18n'
import Button from '@/app/components/base/button'
import Loading from '@/app/components/base/loading'
type Props = {
  collection: Collection
  toolName: string
  setting: Record<string, any>
  onHide: () => void
  onSave: (value: Record<string, any>) => void
}

const SettingBuiltInTool: FC<Props> = ({
  collection,
  toolName,
  setting,
  onHide,
  onSave,
}) => {
  const { locale } = useContext(I18n)
  const { t } = useTranslation()

  const [isLoading, setIsLoading] = useState(true)
  const [tools, setTools] = useState<Tool[]>([])
  const currTool = tools.find(tool => tool.name === toolName)
  const formSchemas = currTool ? toolParametersToFormSchemas(currTool.parameters) : []
  const [tempSetting, setTempSetting] = useState(setting)
  useEffect(() => {
    if (!collection)
      return

    (async () => {
      setIsLoading(true)
      try {
        const list = await fetchBuiltInToolList(collection.name) as Tool[]
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
  }, [collection?.name])

  const isValid = (() => {
    let valid = true
    formSchemas.forEach((item: any) => {
      if (item.required && !tempSetting[item.name])
        valid = false
    })
    return valid
  })()

  return (
    <Drawer
      isShow
      onHide={onHide}
      title={(
        <div className='flex'>
          {typeof collection.icon === 'string'
            ? (
              <div
                className='w-6 h-6 bg-cover bg-center'
                style={{
                  backgroundImage: `url(${collection.icon}?_token=${localStorage.getItem('console_token')})`,
                }}
              ></div>
            )
            : (
              <AppIcon
                size='tiny'
                innerIcon={(collection.icon as any).content}
                background={(collection.icon as any).content}
              />
            )}
          <div className='ml-2 leading-6 text-base font-semibold text-gray-900'>{currTool?.label[locale === 'en' ? 'en_US' : 'zh_Hans']}</div>
        </div>
      )}
      panelClassName='mt-[65px] !w-[480px]'
      maxWidthClassName='!max-w-[480px]'
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
                <Form
                  value={tempSetting}
                  onChange={setTempSetting}
                  formSchemas={formSchemas as any}
                  isEditMode={false}
                  showOnVariableMap={{}}
                  validating={false}
                  inputClassName='!bg-gray-50'
                />
              </div>
              <div className='mt-2 shrink-0 flex justify-end py-4 px-6  space-x-2 rounded-b-[10px] bg-gray-50 border-t border-black/5'>
                <Button className='flex items-center h-8 !px-3 !text-[13px] font-medium !text-gray-700' onClick={onHide}>{t('common.operation.cancel')}</Button>
                <Button className='flex items-center h-8 !px-3 !text-[13px] font-medium' type='primary' disabled={!isValid} onClick={() => onSave(addDefaultValue(tempSetting, formSchemas))}>{t('common.operation.save')}</Button>
              </div>
            </div>)}
        </div>
      }
      isShowMask={true}
      clickOutsideNotOpen={false}
    />
  )
}
export default React.memo(SettingBuiltInTool)
