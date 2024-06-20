'use client'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import {
  RiAddLine,
} from '@remixicon/react'
import type { CustomCollectionBackend } from '../types'
import I18n from '@/context/i18n'
import { getLanguage } from '@/i18n/language'
import { BookOpen01 } from '@/app/components/base/icons/src/vender/line/education'
import { ArrowUpRight } from '@/app/components/base/icons/src/vender/line/arrows'
import EditCustomToolModal from '@/app/components/tools/edit-custom-collection-modal'
import { createCustomCollection } from '@/service/tools'
import Toast from '@/app/components/base/toast'
import { useAppContext } from '@/context/app-context'

type Props = {
  onRefreshData: () => void
}

const Contribute = ({ onRefreshData }: Props) => {
  const { t } = useTranslation()
  const { locale } = useContext(I18n)
  const language = getLanguage(locale)
  const { isCurrentWorkspaceManager } = useAppContext()

  const linkUrl = useMemo(() => {
    if (language.startsWith('zh_'))
      return 'https://docs.dify.ai/v/zh-hans/guides/gong-ju/quick-tool-integration'
    return 'https://docs.dify.ai/tutorials/quick-tool-integration'
  }, [language])

  const [isShowEditCollectionToolModal, setIsShowEditCustomCollectionModal] = useState(false)
  const doCreateCustomToolCollection = async (data: CustomCollectionBackend) => {
    await createCustomCollection(data)
    Toast.notify({
      type: 'success',
      message: t('common.api.actionSuccess'),
    })
    setIsShowEditCustomCollectionModal(false)
    onRefreshData()
  }

  return (
    <>
      {isCurrentWorkspaceManager && (
        <div className='flex flex-col col-span-1 bg-gray-200 border-[0.5px] border-black/5 rounded-xl min-h-[160px] transition-all duration-200 ease-in-out cursor-pointer hover:bg-gray-50 hover:shadow-lg'>
          <div className='group grow rounded-t-xl hover:bg-white' onClick={() => setIsShowEditCustomCollectionModal(true)}>
            <div className='shrink-0 flex items-center p-4 pb-3'>
              <div className='w-10 h-10 flex items-center justify-center border border-gray-200 bg-gray-100 rounded-lg group-hover:border-primary-100 group-hover:bg-primary-50'>
                <RiAddLine className='w-4 h-4 text-gray-500 group-hover:text-primary-600'/>
              </div>
              <div className='ml-3 text-sm font-semibold leading-5 text-gray-800 group-hover:text-primary-600'>{t('tools.createCustomTool')}</div>
            </div>
          </div>
          <div className='px-4 py-3 rounded-b-xl border-t-[0.5px] border-black/5 text-gray-500 hover:text-[#155EEF] hover:bg-white'>
            <a href={linkUrl} target='_blank' rel='noopener noreferrer' className='flex items-center space-x-1'>
              <BookOpen01 className='shrink-0 w-3 h-3' />
              <div className='grow leading-[18px] text-xs font-normal truncate' title={t('tools.customToolTip') || ''}>{t('tools.customToolTip')}</div>
              <ArrowUpRight className='shrink-0 w-3 h-3' />
            </a>
          </div>
        </div>
      )}
      {isShowEditCollectionToolModal && (
        <EditCustomToolModal
          payload={null}
          onHide={() => setIsShowEditCustomCollectionModal(false)}
          onAdd={doCreateCustomToolCollection}
        />
      )}
    </>
  )
}
export default Contribute
