'use client'
import type { FC } from 'react'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import cn from 'classnames'
import type { Collection, CustomCollectionBackend } from '../types'
import Type from './type'
import Category from './category'
import Drawer from '@/app/components/base/drawer'
import Button from '@/app/components/base/button'
// import AppIcon from '@/app/components/base/app-icon'
import SearchInput from '@/app/components/base/search-input'
import { Plus, XClose } from '@/app/components/base/icons/src/vender/line/general'
import EditCustomToolModal from '@/app/components/tools/edit-custom-collection-modal'
import ConfigCredential from '@/app/components/tools/setting/build-in/config-credentials'
import { createCustomCollection, removeBuiltInToolCredential, updateBuiltInToolCredential } from '@/service/tools'
import Toast from '@/app/components/base/toast'

type Props = {
  onHide: () => void
}
// Add and Edit
const AddToolModal: FC<Props> = ({
  onHide,
}) => {
  const { t } = useTranslation()
  const [currentType, setCurrentType] = useState('all')
  const [currentCategory, setCurrentCategory] = useState('')
  const [keywords, setKeywords] = useState<string>('')
  const handleKeywordsChange = (value: string) => {
    setKeywords(value)
  }

  const [isShowEditCollectionToolModal, setIsShowEditCustomCollectionModal] = useState(false)
  const doCreateCustomToolCollection = async (data: CustomCollectionBackend) => {
    await createCustomCollection(data)
    Toast.notify({
      type: 'success',
      message: t('common.api.actionSuccess'),
    })
    setIsShowEditCustomCollectionModal(false)
    // TODO update list
  }
  const [showSettingAuth, setShowSettingAuth] = useState(false)
  const [collection, setCollection] = useState<Collection>()
  const updateBuiltinAuth = async (value: Record<string, any>) => {
    if (!collection)
      return
    await updateBuiltInToolCredential(collection.name, value)
    Toast.notify({
      type: 'success',
      message: t('common.api.actionSuccess'),
    })
    // await onRefreshData()
    setShowSettingAuth(false)
  }
  const removeBuiltinAuth = async () => {
    if (!collection)
      return
    await removeBuiltInToolCredential(collection.name)
    Toast.notify({
      type: 'success',
      message: t('common.api.actionSuccess'),
    })
    // await onRefreshData()
    setShowSettingAuth(false)
  }

  return (
    <>
      <Drawer
        isOpen
        mask
        clickOutsideNotOpen
        onClose={onHide}
        footer={null}
        panelClassname={cn('mt-16 mx-2 sm:mr-2 mb-3 !p-0 rounded-xl', 'mt-2 !w-[640px]', '!max-w-[640px]')}
      >
        <div
          className='w-full flex bg-white border-[0.5px] border-gray-200 rounded-xl shadow-xl'
          style={{
            height: 'calc(100vh - 16px)',
          }}
        >
          <div className='relative shrink-0 w-[200px] pb-[56px] bg-gray-100 rounded-l-xl border-r-[0.5px] border-black/2 overflow-y-auto'>
            <div className='sticky top-0 left-0 right-0 px-5 py-3 text-md font-semibold text-gray-900'>{t('tools.addTool')}</div>
            <div className='px-2 py-1'>
              <Type value={currentType} onSelect={setCurrentType}/>
              <Category value={currentCategory} onSelect={setCurrentCategory}/>
            </div>
            <div className='absolute bottom-0 left-0 p-3'>
              <Button type='primary' className='w-[176px] text-[13px] leading-[18px] font-medium' onClick={() => setIsShowEditCustomCollectionModal(true)}>
                <Plus className='w-4 h-4 mr-1'/>
                {t('tools.createCustomTool')}
              </Button>
            </div>
          </div>
          <div className='relative grow bg-white rounded-r-xl overflow-y-auto'>
            <div className='sticky top-0 left-0 right-0 p-2 flex items-center gap-1'>
              <div className='grow'>
                <SearchInput className='w-full' value={keywords} onChange={handleKeywordsChange} />
              </div>
              <div className='ml-2 mr-1 w-[1px] h-4 bg-gray-200'></div>
              <div className='p-2 cursor-pointer' onClick={onHide}>
                <XClose className='w-4 h-4 text-gray-500' />
              </div>
            </div>
          </div>
        </div>
      </Drawer>
      {isShowEditCollectionToolModal && (
        <EditCustomToolModal
          positionLeft
          payload={null}
          onHide={() => setIsShowEditCustomCollectionModal(false)}
          onAdd={doCreateCustomToolCollection}
        />
      )}
      {showSettingAuth && collection && (
        <ConfigCredential
          collection={collection}
          onCancel={() => setShowSettingAuth(false)}
          onSaved={updateBuiltinAuth}
          onRemove={removeBuiltinAuth}
        />
      )}
    </>

  )
}
export default React.memo(AddToolModal)
