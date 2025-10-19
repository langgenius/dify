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
          <div className={cn('flex cursor-pointer items-center rounded-lg bg-components-input-bg-normal px-3 py-2 hover:bg-state-base-hover', open && 'bg-state-base-hover')}>
            <div className='mr-2 grow text-sm leading-5 text-text-primary'>{t('common.members.invitedAsRole', { role: t(`common.members.${toHump(value)}`) })}</div>
            <RiArrowDownSLine className='h-4 w-4 shrink-0 text-text-secondary' />
          </div>
        </PortalToFollowElemTrigger>
        <PortalToFollowElemContent className='z-[1002]'>
          <div className='relative w-[336px] rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-lg'>
            <div className='p-1'>
              <div className='cursor-pointer rounded-lg p-2 hover:bg-state-base-hover' onClick={() => {
                onChange('normal')
                setOpen(false)
              }}>
                <div className='relative pl-5'>
                  <div className='text-sm leading-5 text-text-secondary'>{t('common.members.normal')}</div>
                  <div className='text-xs leading-[18px] text-text-tertiary'>{t('common.members.normalTip')}</div>
                  {value === 'normal' && <Check className='absolute left-0 top-0.5 h-4 w-4 text-text-accent'/>}
                </div>
              </div>
              <div className='cursor-pointer rounded-lg p-2 hover:bg-state-base-hover' onClick={() => {
                onChange('editor')
                setOpen(false)
              }}>
                <div className='relative pl-5'>
                  <div className='text-sm leading-5 text-text-secondary'>{t('common.members.editor')}</div>
                  <div className='text-xs leading-[18px] text-text-tertiary'>{t('common.members.editorTip')}</div>
                  {value === 'editor' && <Check className='absolute left-0 top-0.5 h-4 w-4 text-text-accent'/>}
                </div>
              </div>
              <div className='cursor-pointer rounded-lg p-2 hover:bg-state-base-hover' onClick={() => {
                onChange('admin')
                setOpen(false)
              }}>
                <div className='relative pl-5'>
                  <div className='text-sm leading-5 text-text-secondary'>{t('common.members.admin')}</div>
                  <div className='text-xs leading-[18px] text-text-tertiary'>{t('common.members.adminTip')}</div>
                  {value === 'admin' && <Check className='absolute left-0 top-0.5 h-4 w-4 text-text-accent'/>}
                </div>
              </div>
              {datasetOperatorEnabled && (
                <div className='cursor-pointer rounded-lg p-2 hover:bg-state-base-hover' onClick={() => {
                  onChange('dataset_operator')
                  setOpen(false)
                }}>
                  <div className='relative pl-5'>
                    <div className='text-sm leading-5 text-text-secondary'>{t('common.members.datasetOperator')}</div>
                    <div className='text-xs leading-[18px] text-text-tertiary'>{t('common.members.datasetOperatorTip')}</div>
                    {value === 'dataset_operator' && <Check className='absolute left-0 top-0.5 h-4 w-4 text-text-accent'/>}
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
