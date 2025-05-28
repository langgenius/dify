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
    return 'https://docs.dify.ai/en/guides/tools#how-to-create-custom-tools'
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
        <div className='col-span-1 flex min-h-[135px] cursor-pointer flex-col rounded-xl border-[0.5px] border-divider-subtle bg-components-panel-on-panel-item-bg transition-all duration-200 ease-in-out hover:bg-components-panel-on-panel-item-bg-hover hover:shadow-lg'>
          <div className='group grow rounded-t-xl hover:bg-background-body' onClick={() => setIsShowEditCustomCollectionModal(true)}>
            <div className='flex shrink-0 items-center p-4 pb-3'>
              <div className='flex h-10 w-10 items-center justify-center rounded-lg border border-components-option-card-option-border bg-components-option-card-option-bg group-hover:border-components-option-card-option-border-hover group-hover:bg-components-option-card-option-bg-hover'>
                <RiAddLine className='h-4 w-4 text-text-tertiary group-hover:text-text-accent'/>
              </div>
              <div className='ml-3 text-sm font-semibold leading-5 text-text-primary group-hover:text-text-accent'>{t('tools.createCustomTool')}</div>
            </div>
          </div>
          <div className='rounded-b-xl border-t-[0.5px] border-divider-regular px-4 py-3 text-text-tertiary hover:bg-background-body hover:text-text-accent'>
            <a href={linkUrl} target='_blank' rel='noopener noreferrer' className='flex items-center space-x-1'>
              <BookOpen01 className='h-3 w-3 shrink-0' />
              <div className='grow truncate text-xs font-normal leading-[18px]' title={t('tools.customToolTip') || ''}>{t('tools.customToolTip')}</div>
              <ArrowUpRight className='h-3 w-3 shrink-0' />
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
