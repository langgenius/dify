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
      return 'https://docs.dify.ai/zh-hans/guides/tools#ru-he-chuang-jian-zi-ding-yi-gong-ju'
    return 'https://docs.dify.ai/guides/tools#how-to-create-custom-tools'
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
        <div className='flex flex-col col-span-1 bg-components-panel-on-panel-item-bg border-[0.5px] border-divider-subtle rounded-xl min-h-[135px] transition-all duration-200 ease-in-out cursor-pointer hover:bg-components-panel-on-panel-item-bg-hover hover:shadow-lg'>
          <div className='group grow rounded-t-xl hover:bg-background-body' onClick={() => setIsShowEditCustomCollectionModal(true)}>
            <div className='shrink-0 flex items-center p-4 pb-3'>
              <div className='w-10 h-10 flex items-center justify-center border border-components-option-card-option-border bg-components-option-card-option-bg rounded-lg group-hover:border-components-option-card-option-border-hover group-hover:bg-components-option-card-option-bg-hover'>
                <RiAddLine className='w-4 h-4 text-text-tertiary group-hover:text-text-accent'/>
              </div>
              <div className='ml-3 text-sm font-semibold leading-5 text-text-primary group-hover:text-text-accent'>{t('tools.createCustomTool')}</div>
            </div>
          </div>
          <div className='px-4 py-3 rounded-b-xl border-t-[0.5px] border-divider-regular text-text-tertiary hover:text-text-accent hover:bg-background-body'>
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
