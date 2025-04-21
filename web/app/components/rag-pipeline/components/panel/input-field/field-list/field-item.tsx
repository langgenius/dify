'use client'
import React, { useCallback, useRef } from 'react'
import { useHover } from 'ahooks'
import { useTranslation } from 'react-i18next'
import {
  RiDeleteBinLine,
  RiEditLine,
} from '@remixicon/react'
import type { InputVar } from '@/app/components/workflow/types'
import { noop } from 'lodash-es'
import { useStore } from '@/app/components/workflow/store'
import { InputField } from '@/app/components/base/icons/src/public/pipeline'
import InputVarTypeIcon from '@/app/components/workflow/nodes/_base/components/input-var-type-icon'
import cn from '@/utils/classnames'
import Badge from '@/app/components/base/badge'

type FieldItemProps = {
  readonly?: boolean
  payload: InputVar
  onRemove?: () => void
}

const FieldItem = ({
  readonly,
  payload,
  onRemove = noop,
}: FieldItemProps) => {
  const { t } = useTranslation()

  const ref = useRef(null)
  const isHovering = useHover(ref)
  const setShowInputFieldEditor = useStore(state => state.setShowInputFieldEditor)

  const showInputFieldEditor = useCallback(() => {
    setShowInputFieldEditor?.(true)
  }, [setShowInputFieldEditor])

  return (
    <div
      ref={ref}
      className={cn(
        'flex h-8 cursor-pointer items-center justify-between gap-x-1 rounded-lg border border-components-panel-border-subtle bg-components-panel-on-panel-item-bg py-1 pl-2 shadow-xs hover:shadow-sm',
        (!isHovering || readonly) ? 'pr-2.5' : !readonly && 'pr-1',
      )}
    >
      <div className='flex grow basis-0 items-center gap-x-1'>
        <InputField className='size-4 text-text-accent' />
        <div
          title={payload.variable}
          className='system-sm-medium max-w-[130px] shrink-0 truncate text-text-secondary'
        >
          {payload.variable}
        </div>
        {payload.label && (
          <>
            <div className='system-xs-regular shrink-0 text-text-quaternary'>·</div>
            <div
              title={payload.label as string}
              className='system-xs-medium max-w-[130px] truncate text-text-tertiary'
            >
              {payload.label as string}
            </div>
          </>
        )}
      </div>
      {(!isHovering || readonly)
        ? (
          <div className='flex shrink-0 items-center gap-x-2'>
            {payload.required && (
              <Badge>{t('workflow.nodes.start.required')}</Badge>
            )}
            <InputVarTypeIcon type={payload.type} className='h-3 w-3 text-text-tertiary' />
          </div>
        )
        : (!readonly && (
          <div className='flex shrink-0 items-center gap-x-1'>
            <button
              type='button'
              className='cursor-pointer rounded-md p-1 hover:bg-state-base-hover'
              onClick={showInputFieldEditor}
            >
              <RiEditLine className='size-4 text-text-tertiary' />
            </button>
            <button
              onClick={onRemove}
              className='group cursor-pointer rounded-md p-1 hover:bg-state-destructive-hover'
            >
              <RiDeleteBinLine className='size-4 text-text-tertiary group-hover:text-text-destructive' />
            </button>
          </div>
        ))
      }
    </div>
  )
}
export default React.memo(FieldItem)
