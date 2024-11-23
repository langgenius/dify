import { useTranslation } from 'react-i18next'
import cn from 'classnames'
import React, { useState } from 'react'
import { RiArrowDownSLine } from '@remixicon/react'
import { useProviderContext } from '@/context/provider-context'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import { Check } from '@/app/components/base/icons/src/vender/line/general'

export type RoleSelectorProps = {
  value: string
  onChange: (role: string) => void
}

const RoleSelector = ({ value, onChange }: RoleSelectorProps) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const { datasetOperatorEnabled } = useProviderContext()

  const toHump = (name: string) => name.replace(/_(\w)/g, (all, letter) => letter.toUpperCase())

  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement='bottom-start'
      offset={4}
    >
      <div className='relative'>
        <PortalToFollowElemTrigger
          onClick={() => setOpen(v => !v)}
          className='block'
        >
          <div className={cn('flex items-center px-3 py-2 rounded-lg bg-gray-100 cursor-pointer hover:bg-gray-200', open && 'bg-gray-200')}>
            <div className='grow mr-2 text-gray-900 text-sm leading-5'>{t('common.members.invitedAsRole', { role: t(`common.members.${toHump(value)}`) })}</div>
            <RiArrowDownSLine className='shrink-0 w-4 h-4 text-gray-700' />
          </div>
        </PortalToFollowElemTrigger>
        <PortalToFollowElemContent className='z-[1002]'>
          <div className='relative w-[336px] bg-white rounded-lg border-[0.5px] bg-gray-200 shadow-lg'>
            <div className='p-1'>
              <div className='p-2 rounded-lg hover:bg-gray-50 cursor-pointer' onClick={() => {
                onChange('normal')
                setOpen(false)
              }}>
                <div className='relative pl-5'>
                  <div className='text-gray-700 text-sm leading-5'>{t('common.members.normal')}</div>
                  <div className='text-gray-500 text-xs leading-[18px]'>{t('common.members.normalTip')}</div>
                  {value === 'normal' && <Check className='absolute top-0.5 left-0 w-4 h-4 text-primary-600'/>}
                </div>
              </div>
              <div className='p-2 rounded-lg hover:bg-gray-50 cursor-pointer' onClick={() => {
                onChange('editor')
                setOpen(false)
              }}>
                <div className='relative pl-5'>
                  <div className='text-gray-700 text-sm leading-5'>{t('common.members.editor')}</div>
                  <div className='text-gray-500 text-xs leading-[18px]'>{t('common.members.editorTip')}</div>
                  {value === 'editor' && <Check className='absolute top-0.5 left-0 w-4 h-4 text-primary-600'/>}
                </div>
              </div>
              <div className='p-2 rounded-lg hover:bg-gray-50 cursor-pointer' onClick={() => {
                onChange('admin')
                setOpen(false)
              }}>
                <div className='relative pl-5'>
                  <div className='text-gray-700 text-sm leading-5'>{t('common.members.admin')}</div>
                  <div className='text-gray-500 text-xs leading-[18px]'>{t('common.members.adminTip')}</div>
                  {value === 'admin' && <Check className='absolute top-0.5 left-0 w-4 h-4 text-primary-600'/>}
                </div>
              </div>
              {datasetOperatorEnabled && (
                <div className='p-2 rounded-lg hover:bg-gray-50 cursor-pointer' onClick={() => {
                  onChange('dataset_operator')
                  setOpen(false)
                }}>
                  <div className='relative pl-5'>
                    <div className='text-gray-700 text-sm leading-5'>{t('common.members.datasetOperator')}</div>
                    <div className='text-gray-500 text-xs leading-[18px]'>{t('common.members.datasetOperatorTip')}</div>
                    {value === 'dataset_operator' && <Check className='absolute top-0.5 left-0 w-4 h-4 text-primary-600'/>}
                  </div>
                </div>
              )}
            </div>
          </div>
        </PortalToFollowElemContent>
      </div>
    </PortalToFollowElem>
  )
}

export default RoleSelector
