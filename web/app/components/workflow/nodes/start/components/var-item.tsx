'use client'
import type { FC } from 'react'
import React, { useCallback, useRef } from 'react'
import { useBoolean, useHover } from 'ahooks'
import { useTranslation } from 'react-i18next'
import {
  RiDeleteBinLine,
  RiEditLine,
} from '@remixicon/react'
import InputVarTypeIcon from '../../_base/components/input-var-type-icon'
import type { InputVar, MoreInfo } from '@/app/components/workflow/types'
import { Variable02 } from '@/app/components/base/icons/src/vender/solid/development'
import Badge from '@/app/components/base/badge'
import ConfigVarModal from '@/app/components/app/configuration/config-var/config-modal'

type Props = {
  readonly: boolean
  payload: InputVar
  onChange?: (item: InputVar, moreInfo?: MoreInfo) => void
  onRemove?: () => void
  rightContent?: JSX.Element
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
    <div ref={ref} className='flex items-center h-8 justify-between px-2.5 bg-components-panel-on-panel-item-bg rounded-lg border border-components-panel-border-subtle shadow-xs cursor-pointer hover:shadow-md shadow-shadow-shadow-3'>
      <div className='flex items-center space-x-1 grow w-0'>
        <Variable02 className='w-3.5 h-3.5 text-text-accent' />
        <div title={payload.variable} className='shrink-0 max-w-[130px] truncate system-sm-medium text-text-secondary'>{payload.variable}</div>
        {payload.label && (<><div className='shrink-0 system-xs-regular text-text-quaternary'>·</div>
          <div title={payload.label as string} className='max-w-[130px] truncate system-xs-medium text-text-tertiary'>{payload.label as string}</div>
        </>)}
        {showLegacyBadge && (
          <Badge
            text='LEGACY'
            className='shrink-0 border-text-accent-secondary text-text-accent-secondary'
          />
        )}
      </div>
      <div className='shrink-0 ml-2 flex items-center'>
        {rightContent || (<>
          {(!isHovering || readonly)
            ? (
              <>
                {payload.required && (
                  <Badge className='mr-2' uppercase>{t('workflow.nodes.start.required')}</Badge>
                )}
                <InputVarTypeIcon type={payload.type} className='w-3 h-3 text-text-tertiary' />
              </>
            )
            : (!readonly && (
              <>
                <div onClick={showEditVarModal} className='mr-1 p-1 cursor-pointer'>
                  <RiEditLine className='w-4 h-4 text-text-tertiary' />
                </div>
                <div onClick={onRemove} className='p-1 cursor-pointer'>
                  <RiDeleteBinLine className='w-4 h-4 text-text-tertiary' />
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
