import type { FC, ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import cn from 'classnames'
import s from './common.module.css'
import Modal from '@/app/components/base/modal'
import { XClose } from '@/app/components/base/icons/src/vender/line/general'
import { AlertCircle } from '@/app/components/base/icons/src/vender/solid/alertsAndFeedback'
import { CheckCircle } from '@/app/components/base/icons/src/vender/solid/general'
import Button from '@/app/components/base/button'

export type ConfirmCommonProps = {
  type?: string
  isShow: boolean
  onCancel: () => void
  title: string
  desc?: string
  onConfirm?: () => void
  showOperate?: boolean
  showOperateCancel?: boolean
  confirmBtnClassName?: string
  confirmText?: string
  confirmWrapperClassName?: string
  confirmDisabled?: boolean
}

const ConfirmCommon: FC<ConfirmCommonProps> = ({
  type = 'danger',
  isShow,
  onCancel,
  title,
  desc,
  onConfirm,
  showOperate = true,
  showOperateCancel = true,
  confirmBtnClassName,
  confirmText,
  confirmWrapperClassName,
  confirmDisabled,
}) => {
  const { t } = useTranslation()

  const CONFIRM_MAP: Record<string, { icon: ReactElement; confirmText: string }> = {
    danger: {
      icon: <AlertCircle className='w-6 h-6 text-[#D92D20]' />,
      confirmText: t('common.operation.remove'),
    },
    success: {
      icon: <CheckCircle className='w-6 h-6 text-[#039855]' />,
      confirmText: t('common.operation.ok'),
    },
  }

  return (
    <Modal isShow={isShow} onClose={() => {}} className='!w-[480px] !max-w-[480px] !p-0 !rounded-2xl' wrapperClassName={confirmWrapperClassName}>
      <div className={cn(s[`wrapper-${type}`], 'relative p-8')}>
        <div className='flex items-center justify-center absolute top-4 right-4 w-8 h-8 cursor-pointer' onClick={onCancel}>
          <XClose className='w-4 h-4 text-gray-500' />
        </div>
        <div className='flex items-center justify-center mb-3 w-12 h-12 bg-white shadow-xl rounded-xl'>
          {CONFIRM_MAP[type].icon}
        </div>
        <div className='text-xl font-semibold text-gray-900'>{title}</div>
        {
          desc && <div className='mt-1 text-sm text-gray-500'>{desc}</div>
        }
        {
          showOperate && (
            <div className='flex items-center justify-end mt-10'>
              {
                showOperateCancel && (
                  <Button
                    className='mr-2 min-w-24 text-sm font-medium !text-gray-700'
                    onClick={onCancel}
                  >
                    {t('common.operation.cancel')}
                  </Button>
                )
              }
              <Button
                type='primary'
                className={confirmBtnClassName || ''}
                onClick={onConfirm}
                disabled={confirmDisabled}
              >
                {confirmText || CONFIRM_MAP[type].confirmText}
              </Button>
            </div>
          )
        }
      </div>
    </Modal>
  )
}

export default ConfirmCommon
