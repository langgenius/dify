'use client'

// import type { MouseEventHandler } from 'react'
import cn from 'classnames'
import { useState } from 'react'
import { useContext } from 'use-context-selector'
import { useTranslation } from 'react-i18next'
// import Button from '@/app/components/base/button'
import Modal from '@/app/components/base/modal'
import { ToastContext } from '@/app/components/base/toast'
import { XClose } from '@/app/components/base/icons/src/vender/line/general'
// import type { DataSet } from '@/models/datasets'

type TagManagementModalProps = {
  type: 'knowledge' | 'app'
  show: boolean
}

const TagManagementModal = ({ show }: TagManagementModalProps) => {
  const { t } = useTranslation()
  const { notify } = useContext(ToastContext)
  const [loading, setLoading] = useState(false)
  const [name, setName] = useState<string>('')

  return (
    <Modal
      wrapperClassName='z-20'
      className='px-8 py-6 max-w-[600px] w-[600px] rounded-xl'
      isShow={show}
      onClose={() => {}}
    >
      <div className='relative pb-2 text-xl font-medium leading-[30px] text-gray-900'>{t('datasetSettings.tag.manageTags')}</div>
      <div className='absolute right-4 top-4 p-2 cursor-pointer' onClick={() => {}}>
        <XClose className='w-4 h-4 text-gray-500' />
      </div>
      <div>
        <div className={cn('flex justify-between py-4 flex-wrap items-center')}>
          <div className='shrink-0 py-2 text-sm font-medium leading-[20px] text-gray-900'>
            {t('datasetSettings.form.name')}
          </div>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            className='block px-3 w-full h-9 bg-gray-100 rounded-lg text-sm text-gray-900 outline-none appearance-none'
            placeholder={t('datasetSettings.form.namePlaceholder') || ''}
          />
        </div>
      </div>
    </Modal>
  )
}

export default TagManagementModal
