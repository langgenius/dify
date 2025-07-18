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
import { noop } from 'lodash-es'
import cn from '@/utils/classnames'

type Props = {
  className?: string
  readonly: boolean
  payload: InputVar
  onChange?: (item: InputVar, moreInfo?: MoreInfo) => void
  onRemove?: () => void
  rightContent?: React.JSX.Element
  varKeys?: string[]
  showLegacyBadge?: boolean,
  canDrag?: boolean,
}

const VarItem: FC<Props> = ({
  className,
  readonly,
  payload,
  onChange = noop,
  onRemove = noop,
  rightContent,
  varKeys = [],
  showLegacyBadge = false,
  canDrag,
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
    <div ref={ref} className={cn('flex h-8 cursor-pointer items-center justify-between rounded-lg border border-components-panel-border-subtle bg-components-panel-on-panel-item-bg px-2.5 shadow-xs hover:shadow-md', className)}>
      <div className='flex w-0 grow items-center space-x-1'>
        <Variable02 className={cn('h-3.5 w-3.5 text-text-accent', canDrag && 'group-hover:opacity-0')} />
        <div title={payload.variable} className='max-w-[130px] shrink-0 truncate text-[13px] font-medium text-text-secondary'>{payload.variable}</div>
        {payload.label && (<><div className='shrink-0 text-xs font-medium text-text-quaternary'>·</div>
          <div title={payload.label as string} className='max-w-[130px] truncate text-[13px] font-medium text-text-tertiary'>{payload.label as string}</div>
        </>)}
        {showLegacyBadge && (
          <Badge
            text='LEGACY'
            className='shrink-0 border-text-accent-secondary text-text-accent-secondary'
          />
        )}
      </div>
      <div className='ml-2 flex shrink-0 items-center'>
        {rightContent || (<>
          {(!isHovering || readonly)
            ? (
              <>
                {payload.required && (
                  <div className='mr-2 text-xs font-normal text-text-tertiary'>{t('workflow.nodes.start.required')}</div>
                )}
                <InputVarTypeIcon type={payload.type} className='h-3.5 w-3.5 text-text-tertiary' />
              </>
            )
            : (!readonly && (
              <>
                <div onClick={showEditVarModal} className='mr-1 cursor-pointer rounded-md p-1 hover:bg-state-base-hover'>
                  <Edit03 className='h-4 w-4 text-text-tertiary' />
                </div>
                <div onClick={onRemove} className='group cursor-pointer rounded-md p-1 hover:bg-state-destructive-hover'>
                  <RiDeleteBinLine className='h-4 w-4 text-text-tertiary group-hover:text-text-destructive' />
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
