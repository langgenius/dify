'use client'
import type { FC } from 'react'
import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import {
  RiArrowLeftLine,
  RiCloseLine,
} from '@remixicon/react'
import Drawer from '@/app/components/base/drawer'
import Loading from '@/app/components/base/loading'
import ActionButton from '@/app/components/base/action-button'
import Icon from '@/app/components/plugins/card/base/card-icon'
import OrgInfo from '@/app/components/plugins/card/base/org-info'
import Description from '@/app/components/plugins/card/base/description'
import Button from '@/app/components/base/button'
import Form from '@/app/components/header/account-setting/model-provider-page/model-modal/Form'
import { addDefaultValue, toolParametersToFormSchemas } from '@/app/components/tools/utils/to-form-schema'
import type { Collection, Tool } from '@/app/components/tools/types'
import { CollectionType } from '@/app/components/tools/types'
import { fetchBuiltInToolList, fetchCustomToolList, fetchModelToolList, fetchWorkflowToolList } from '@/service/tools'
import I18n from '@/context/i18n'
import { DiagonalDividingLine } from '@/app/components/base/icons/src/public/common'
import { getLanguage } from '@/i18n/language'
import cn from '@/utils/classnames'

interface Props {
  showBackButton?: boolean
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
  showBackButton = false,
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
      {infoSchemas.length > 0 && (
        <div className='my-2'>
          <div className='pt-3 text-text-secondary system-sm-semibold-uppercase'>
            {t('tools.setBuiltInTools.parameters')}
          </div>
          <div className='py-2 space-y-3'>
            {infoSchemas.map((item: any, index) => (
              <div key={index} className='py-1'>
                <div className='flex items-center gap-2'>
                  <div className='text-text-secondary code-sm-semibold'>{item.label[language]}</div>
                  <div className='text-text-tertiary system-xs-regular'>{item.type === 'number-input' ? t('tools.setBuiltInTools.number') : t('tools.setBuiltInTools.string')}</div>
                  {item.required && (
                    <div className='text-text-warning-secondary system-xs-medium'>{t('tools.setBuiltInTools.required')}</div>
                  )}
                </div>
                {item.human_description && (
                  <div className='mt-0.5 text-text-tertiary system-xs-regular'>
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
      isOpen
      clickOutsideNotOpen={false}
      onClose={onHide}
      footer={null}
      mask={false}
      positionCenter={false}
      panelClassname={cn('justify-start mt-[64px] mr-2 mb-2 !w-[420px] !max-w-[420px] !p-0 !bg-components-panel-bg rounded-2xl border-[0.5px] border-components-panel-border shadow-xl')}
    >
      <>
        {isLoading && <Loading type='app' />}
        {!isLoading && (
          <>
            {/* header */}
            <div className='relative p-4 pb-3 border-b border-divider-subtle'>
              <div className='absolute top-3 right-3'>
                <ActionButton onClick={onHide}>
                  <RiCloseLine className='w-4 h-4' />
                </ActionButton>
              </div>
              {showBackButton && (
                <div
                  className='mb-2 flex items-center gap-1 text-text-accent-secondary system-xs-semibold-uppercase cursor-pointer'
                  onClick={onHide}
                >
                  <RiArrowLeftLine className='w-4 h-4' />
                  BACK
                </div>
              )}
              <div className='flex items-center gap-1'>
                <Icon size='xs' className='w-5 h-5' src={collection.icon} />
                <OrgInfo
                  packageNameClassName='w-auto'
                  orgName={collection.author}
                  packageName={collection.name}
                />
              </div>
              <div className='mt-1 text-text-primary system-md-semibold'>{currTool?.label[language]}</div>
              {!!currTool?.description[language] && (
                <Description className='mt-3' text={currTool.description[language]} descriptionLineRows={2}></Description>
              )}
            </div>
            {/* form */}
            <div className='h-full'>
              <div className='flex flex-col h-full'>
                <div className='grow h-0 overflow-y-auto px-4'>
                  {(hasSetting && !readonly) && (<>
                    <DiagonalDividingLine className='mx-4' />
                    <div className='flex space-x-6'>
                      <div
                        className={cn(isInfoActive ? 'text-gray-900 font-semibold' : 'font-normal text-gray-600 cursor-pointer', 'relative text-base')}
                        onClick={() => setCurrType('info')}
                      >
                        {t('tools.setBuiltInTools.parameters')}
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
                  {isInfoActive ? infoUI : settingUI}
                </div>
                {!readonly && !isInfoActive && (
                  <div className='mt-2 shrink-0 flex justify-end py-4 px-6  space-x-2 rounded-b-[10px] bg-gray-50 border-t border-black/5'>
                    <Button className='flex items-center h-8 !px-3 !text-[13px] font-medium !text-gray-700' onClick={onHide}>{t('common.operation.cancel')}</Button>
                    <Button className='flex items-center h-8 !px-3 !text-[13px] font-medium' variant='primary' disabled={!isValid} onClick={() => onSave?.(addDefaultValue(tempSetting, formSchemas))}>{t('common.operation.save')}</Button>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </>
    </Drawer>
  )
}
export default React.memo(SettingBuiltInTool)
