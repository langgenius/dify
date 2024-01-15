'use client'
import type { FC } from 'react'
import React, { useEffect, useState } from 'react'
import { useContext } from 'use-context-selector'
import Drawer from '@/app/components/base/drawer-plus'
import Form from '@/app/components/header/account-setting/model-provider-page/model-modal/Form'
import { toolParametersToFormSchemas } from '@/app/components/tools/utils/to-form-schema'
import type { Collection, Tool } from '@/app/components/tools/types'
import { CollectionType } from '@/app/components/tools/types'
import { fetchBuiltInToolList, fetchCustomToolList } from '@/service/tools'
import AppIcon from '@/app/components/base/app-icon'
import I18n from '@/context/i18n'

import Loading from '@/app/components/base/loading'
type Props = {
  collection: Collection
  toolName: string
  setting: Record<string, any>
  onHide: () => void
}

const SettingBuiltInTool: FC<Props> = ({
  collection,
  toolName,
  setting,
  onHide,
}) => {
  const { locale } = useContext(I18n)

  const [isLoading, setIsLoading] = useState(true)
  const [tools, setTools] = useState<Tool[]>([])
  const currTool = tools.find(tool => tool.name === toolName)
  const formSchemas = currTool ? toolParametersToFormSchemas(currTool.parameters) : {}

  useEffect(() => {
    if (!collection)
      return

    (async () => {
      setIsLoading(true)
      try {
        if (collection.type === CollectionType.builtIn) {
          const list = await fetchBuiltInToolList(collection.name) as Tool[]
          setTools(list)
        }
        else {
          const list = await fetchCustomToolList(collection.name) as Tool[]
          setTools(list)
        }
      }
      catch (e) { }
      setIsLoading(false)
    })()
  }, [collection.name])

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
        <div className='px-6 py-3'>
          {isLoading
            ? <div className='flex h-full items-center'>
              <Loading type='app' />
            </div>
            : <Form
              value={setting}
              onChange={() => { }}
              formSchemas={formSchemas as any}
              isEditMode={false}
              readonly
              showOnVariableMap={{}}
              validating={false}
              inputClassName='!bg-gray-50'
            />}
        </div>
      }
      isShowMask={true}
      clickOutsideNotOpen={false}
    />
  )
}
export default React.memo(SettingBuiltInTool)
