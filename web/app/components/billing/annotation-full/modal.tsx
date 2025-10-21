'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import UpgradeBtn from '../upgrade-btn'
import Modal from '../../base/modal'
import Usage from './usage'
import s from './style.module.css'
import cn from '@/utils/classnames'
import GridMask from '@/app/components/base/grid-mask'

type Props = {
  show: boolean
  onHide: () => void
}
const AnnotationFullModal: FC<Props> = ({
  show,
  onHide,
}) => {
  const { t } = useTranslation()

  return (
    <Modal
      isShow={show}
      onClose={onHide}
      closable
      className='!p-0'
    >
      <GridMask wrapperClassName='rounded-lg' canvasClassName='rounded-lg' gradientClassName='rounded-lg'>
        <div className='mt-6 flex cursor-pointer flex-col rounded-lg border-2 border-solid border-transparent px-7 py-6 shadow-md transition-all duration-200 ease-in-out'>
          <div className='flex items-center justify-between'>
            <div className={cn(s.textGradient, 'text-[18px] font-semibold leading-[27px]')}>
              <div>{t('billing.annotatedResponse.fullTipLine1')}</div>
              <div>{t('billing.annotatedResponse.fullTipLine2')}</div>
            </div>

          </div>
          <Usage className='mt-4' />
          <div className='mt-7 flex justify-end'>
            <UpgradeBtn loc={'annotation-create'} />
          </div>
        </div>
      </GridMask>
    </Modal>
  )
}
export default React.memo(AnnotationFullModal)
