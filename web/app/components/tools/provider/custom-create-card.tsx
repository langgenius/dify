'use client'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import {
  RiAddCircleFill,
  RiArrowRightUpLine,
  RiBookOpenLine,
} from '@remixicon/react'
import type { CustomCollectionBackend } from '../types'
import I18n from '@/context/i18n'
import { getLanguage } from '@/i18n/language'
import EditCustomToolModal from '@/app/components/tools/edit-custom-collection-modal'
import { createCustomCollection } from '@/service/tools'
import Toast from '@/app/components/base/toast'
import { useAppContext } from '@/context/app-context'
import { useDocLink } from '@/context/i18n'

type Props = {
  onRefreshData: () => void
}

const Contribute = ({ onRefreshData }: Props) => {
  const { t } = useTranslation()
  const { locale } = useContext(I18n)
  const language = getLanguage(locale)
  const { isCurrentWorkspaceManager } = useAppContext()

  const docLink = useDocLink()
  const linkUrl = useMemo(() => {
    return docLink('/guides/tools#how-to-create-custom-tools', {
      'zh-Hans': '/guides/tools#ru-he-chuang-jian-zi-ding-yi-gong-ju',
    })
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
        <div className='col-span-1 flex min-h-[135px] cursor-pointer flex-col rounded-xl bg-background-default-dimmed transition-all duration-200 ease-in-out'>
          <div className='group grow rounded-t-xl' onClick={() => setIsShowEditCustomCollectionModal(true)}>
            <div className='flex shrink-0 items-center p-4 pb-3'>
              <div className='flex h-10 w-10 items-center justify-center rounded-lg border border-dashed border-divider-deep group-hover:border-solid group-hover:border-state-accent-hover-alt group-hover:bg-state-accent-hover'>
                <RiAddCircleFill className='h-4 w-4 text-text-quaternary group-hover:text-text-accent'/>
              </div>
              <div className='system-md-semibold ml-3 text-text-secondary group-hover:text-text-accent'>{t('tools.createCustomTool')}</div>
            </div>
          </div>
          <div className='rounded-b-xl border-t-[0.5px] border-divider-subtle px-4 py-3 text-text-tertiary hover:text-text-accent'>
            <a href={linkUrl} target='_blank' rel='noopener noreferrer' className='flex items-center space-x-1'>
              <RiBookOpenLine className='h-3 w-3 shrink-0' />
              <div className='system-xs-regular grow truncate' title={t('tools.customToolTip') || ''}>{t('tools.customToolTip')}</div>
              <RiArrowRightUpLine className='h-3 w-3 shrink-0' />
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
