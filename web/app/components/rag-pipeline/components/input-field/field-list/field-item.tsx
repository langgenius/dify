'use client'
import React, { useCallback, useRef } from 'react'
import { useHover } from 'ahooks'
import { useTranslation } from 'react-i18next'
import {
  RiDeleteBinLine,
  RiDraggable,
  RiEditLine,
} from '@remixicon/react'
import { InputField } from '@/app/components/base/icons/src/vender/pipeline'
import InputVarTypeIcon from '@/app/components/workflow/nodes/_base/components/input-var-type-icon'
import cn from '@/utils/classnames'
import Badge from '@/app/components/base/badge'
import type { InputVar } from '@/models/pipeline'
import type { InputVarType } from '@/app/components/workflow/types'
import ActionButton from '@/app/components/base/action-button'

type FieldItemProps = {
  readonly?: boolean
  payload: InputVar
  onClickEdit: (id: string) => void
  onRemove: (id: string) => void
}

const FieldItem = ({
  readonly,
  payload,
  onClickEdit,
  onRemove,
}: FieldItemProps) => {
  const { t } = useTranslation()

  const ref = useRef(null)
  const isHovering = useHover(ref)

  const handleOnClickEdit = useCallback(() => {
    if (readonly) return
    onClickEdit(payload.variable)
  }, [onClickEdit, payload.variable, readonly])

  const handleRemove = useCallback(() => {
    if (readonly) return
    onRemove(payload.variable)
  }, [onRemove, payload.variable, readonly])

  return (
    <div
      ref={ref}
      className={cn(
        'flex h-8 cursor-pointer items-center justify-between gap-x-1 rounded-lg border border-components-panel-border-subtle bg-components-panel-on-panel-item-bg py-1 pl-2 shadow-xs hover:shadow-sm',
        (isHovering && !readonly) ? 'pr-1' : 'pr-2.5',
      )}
    >
      <div className='flex grow basis-0 items-center gap-x-1'>
        {
          isHovering
            ? <RiDraggable className='handle h-4 w-4 cursor-all-scroll text-text-quaternary' />
            : <InputField className='size-4 text-text-accent' />
        }
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
      {(isHovering && !readonly)
        ? (
          <div className='flex shrink-0 items-center gap-x-1'>
            <ActionButton
              className='mr-1'
              onClick={handleOnClickEdit}
            >
              <RiEditLine className='size-4 text-text-tertiary' />
            </ActionButton>
            <ActionButton
              onClick={handleRemove}
            >
              <RiDeleteBinLine className='size-4 text-text-tertiary group-hover:text-text-destructive' />
            </ActionButton>
          </div>
        )
        : (
          <div className='flex shrink-0 items-center gap-x-2'>
            {payload.required && (
              <Badge>{t('workflow.nodes.start.required')}</Badge>
            )}
            <InputVarTypeIcon type={payload.type as unknown as InputVarType} className='h-3 w-3 text-text-tertiary' />
          </div>
        )
      }
    </div>
  )
}
export default React.memo(FieldItem)
