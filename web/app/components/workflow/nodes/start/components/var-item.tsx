'use client'
import type { FC } from 'react'
import React, { useCallback, useRef } from 'react'
import { useBoolean, useHover } from 'ahooks'
import { useTranslation } from 'react-i18next'
import {
  RiDeleteBinLine,
} from '@remixicon/react'
import InputVarTypeIcon from '../../_base/components/input-var-type-icon'
import type { InputVar, MoreInfo } from '@/app/components/workflow/types'
import { Variable02 } from '@/app/components/base/icons/src/vender/solid/development'
import { Edit03 } from '@/app/components/base/icons/src/vender/solid/general'
import Badge from '@/app/components/base/badge'
import ConfigVarModal from '@/app/components/app/configuration/config-var/config-modal'

interface Props {
  readonly: boolean
  payload: InputVar
  onChange?: (item: InputVar, moreInfo?: MoreInfo) => void
  onRemove?: () => void
  rightContent?: React.JSX.Element
  varKeys?: string[]
  showLegacyBadge?: boolean
}

const VarItem: FC<Props> = ({
  readonly,
  payload,
  onChange = () => { },
  onRemove = () => { },
  rightContent,
  varKeys = [],
  showLegacyBadge = false,
}) => {
  const { t } = useTranslation()

  const ref = useRef(null)
  const isHovering = useHover(ref)
  const [isShowEditVarModal, {
    setTrue: showEditVarModal,
    setFalse: hideEditVarModal,
  }] = useBoolean(false)

  const handlePayloadChange = useCallback((payload: InputVar, moreInfo?: MoreInfo) => {
    onChange(payload, moreInfo)
    hideEditVarModal()
  }, [onChange, hideEditVarModal])
  return (
    <div ref={ref} className='shadow-xs flex h-8 cursor-pointer items-center justify-between rounded-lg border border-gray-200 bg-white px-2.5 hover:shadow-md'>
      <div className='flex w-0 grow items-center space-x-1'>
        <Variable02 className='text-primary-500 h-3.5 w-3.5' />
        <div title={payload.variable} className='max-w-[130px] shrink-0 truncate text-[13px] font-medium text-gray-700'>{payload.variable}</div>
        {payload.label && (<><div className='shrink-0 text-xs font-medium text-gray-400'>·</div>
          <div title={payload.label as string} className='max-w-[130px] truncate text-[13px] font-medium text-gray-500'>{payload.label as string}</div>
        </>)}
        {showLegacyBadge && (
          <Badge
            text='LEGACY'
            className='border-text-accent-secondary text-text-accent-secondary shrink-0'
          />
        )}
      </div>
      <div className='ml-2 flex shrink-0 items-center'>
        {rightContent || (<>
          {(!isHovering || readonly)
            ? (
              <>
                {payload.required && (
                  <div className='mr-2 text-xs font-normal text-gray-500'>{t('workflow.nodes.start.required')}</div>
                )}
                <InputVarTypeIcon type={payload.type} className='h-3.5 w-3.5 text-gray-500' />
              </>
            )
            : (!readonly && (
              <>
                <div onClick={showEditVarModal} className='mr-1 cursor-pointer rounded-md p-1 hover:bg-black/5'>
                  <Edit03 className='h-4 w-4 text-gray-500' />
                </div>
                <div onClick={onRemove} className='cursor-pointer rounded-md p-1 hover:bg-black/5'>
                  <RiDeleteBinLine className='h-4 w-4 text-gray-500' />
                </div>
              </>
            ))}
        </>)}

      </div>
      {
        isShowEditVarModal && (
          <ConfigVarModal
            isShow
            supportFile
            payload={payload}
            onClose={hideEditVarModal}
            onConfirm={handlePayloadChange}
            varKeys={varKeys}
          />
        )
      }
    </div>
  )
}
export default React.memo(VarItem)
