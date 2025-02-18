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
import TabSlider from '@/app/components/base/tab-slider-plain'

import Button from '@/app/components/base/button'
import Form from '@/app/components/header/account-setting/model-provider-page/model-modal/Form'
import { addDefaultValue, toolParametersToFormSchemas } from '@/app/components/tools/utils/to-form-schema'
import type { Collection, Tool } from '@/app/components/tools/types'
import { CollectionType } from '@/app/components/tools/types'
import { fetchBuiltInToolList, fetchCustomToolList, fetchModelToolList, fetchWorkflowToolList } from '@/service/tools'
import I18n from '@/context/i18n'
import { getLanguage } from '@/i18n/language'
import cn from '@/utils/classnames'

type Props = {
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

  const getType = (type: string) => {
    if (type === 'number-input')
      return t('tools.setBuiltInTools.number')
    if (type === 'text-input')
      return t('tools.setBuiltInTools.string')
    if (type === 'file')
      return t('tools.setBuiltInTools.file')
    return type
  }

  const infoUI = (
    <div className=''>
      {infoSchemas.length > 0 && (
        <div className='space-y-1 py-2'>
          {infoSchemas.map((item: any, index) => (
            <div key={index} className='py-1'>
              <div className='flex items-center gap-2'>
                <div className='text-text-secondary code-sm-semibold'>{item.label[language]}</div>
                <div className='text-text-tertiary system-xs-regular'>
                  {getType(item.type)}
                </div>
                {item.required && (
                  <div className='text-text-warning-secondary system-xs-medium'>{t('tools.setBuiltInTools.required')}</div>
                )}
              </div>
              {item.human_description && (
                <div className='text-text-tertiary system-xs-regular mt-0.5'>
                  {item.human_description?.[language]}
                </div>
              )}
            </div>
          ))}
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
      panelClassname={cn('!bg-components-panel-bg border-components-panel-border mb-2 mr-2 mt-[64px] !w-[420px] !max-w-[420px] justify-start rounded-2xl border-[0.5px] !p-0 shadow-xl')}
    >
      <>
        {isLoading && <Loading type='app' />}
        {!isLoading && (
          <>
            {/* header */}
            <div className='border-divider-subtle relative border-b p-4 pb-3'>
              <div className='absolute right-3 top-3'>
                <ActionButton onClick={onHide}>
                  <RiCloseLine className='h-4 w-4' />
                </ActionButton>
              </div>
              {showBackButton && (
                <div
                  className='text-text-accent-secondary system-xs-semibold-uppercase mb-2 flex cursor-pointer items-center gap-1'
                  onClick={onHide}
                >
                  <RiArrowLeftLine className='h-4 w-4' />
                  BACK
                </div>
              )}
              <div className='flex items-center gap-1'>
                <Icon size='tiny' className='h-6 w-6' src={collection.icon} />
                <OrgInfo
                  packageNameClassName='w-auto'
                  orgName={collection.author}
                  packageName={collection.name.split('/').pop() || ''}
                />
              </div>
              <div className='text-text-primary system-md-semibold mt-1'>{currTool?.label[language]}</div>
              {!!currTool?.description[language] && (
                <Description className='mt-3' text={currTool.description[language]} descriptionLineRows={2}></Description>
              )}
            </div>
            {/* form */}
            <div className='h-full'>
              <div className='flex h-full flex-col'>
                {(hasSetting && !readonly) ? (
                  <TabSlider
                    className='mt-1 shrink-0 px-4'
                    itemClassName='py-3'
                    noBorderBottom
                    value={currType}
                    onChange={(value) => {
                      setCurrType(value)
                    }}
                    options={[
                      { value: 'info', text: t('tools.setBuiltInTools.parameters')! },
                      { value: 'setting', text: t('tools.setBuiltInTools.setting')! },
                    ]}
                  />
                ) : (
                  <div className='text-text-primary system-sm-semibold-uppercase p-4 pb-1'>{t('tools.setBuiltInTools.parameters')}</div>
                )}
                <div className='h-0 grow overflow-y-auto px-4'>
                  {isInfoActive ? infoUI : settingUI}
                </div>
                {!readonly && !isInfoActive && (
                  <div className='bg-components-panel-bg border-divider-regular mt-2 flex shrink-0 justify-end  space-x-2 rounded-b-[10px] border-t px-6 py-4'>
                    <Button className='flex h-8 items-center !px-3 !text-[13px] font-medium ' onClick={onHide}>{t('common.operation.cancel')}</Button>
                    <Button className='flex h-8 items-center !px-3 !text-[13px] font-medium' variant='primary' disabled={!isValid} onClick={() => onSave?.(addDefaultValue(tempSetting, formSchemas))}>{t('common.operation.save')}</Button>
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
