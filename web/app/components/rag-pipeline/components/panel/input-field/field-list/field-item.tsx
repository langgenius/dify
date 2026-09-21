'use client'
import type { useKeyboardSortable } from '@/app/components/base/keyboard-sortable/use-keyboard-sortable'
import type { InputVarType } from '@/app/components/workflow/types'
import type { InputVar } from '@/models/pipeline'
import { cn } from '@langgenius/dify-ui/cn'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import {
  RiArrowDownLine,
  RiArrowUpLine,
  RiDeleteBinLine,
  RiDraggable,
  RiEditLine,
} from '@remixicon/react'
import * as React from 'react'
import { useCallback, useId } from 'react'
import { useTranslation } from 'react-i18next'
import Badge from '@/app/components/base/badge'
import { InputField } from '@/app/components/base/icons/src/vender/pipeline'
import InputVarTypeIcon from '@/app/components/workflow/nodes/_base/components/input-var-type-icon'

type FieldItemProps = {
  readonly?: boolean
  dragHandleProps?: ReturnType<ReturnType<typeof useKeyboardSortable>['getHandleProps']>
  payload: InputVar
  index: number
  onClickEdit: (id: string) => void
  onRemove: (index: number) => void
  onMoveUp?: () => void
  onMoveDown?: () => void
}

const FieldItem = ({
  readonly,
  payload,
  index,
  onClickEdit,
  onRemove,
  dragHandleProps,
  onMoveUp,
  onMoveDown,
}: FieldItemProps) => {
  const { t } = useTranslation()

  const fieldNameId = useId()

  const handleOnClickEdit = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      if (readonly) return
      onClickEdit(payload.variable)
    },
    [onClickEdit, payload.variable, readonly],
  )

  const handleRemove = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      if (readonly) return
      onRemove(index)
    },
    [index, onRemove, readonly],
  )

  return (
    <div
      className={cn(
        'group flex min-h-8 items-center justify-between gap-x-1 rounded-lg border border-components-panel-border-subtle bg-components-panel-on-panel-item-bg py-1 pr-1 pl-2 shadow-xs hover:shadow-sm',
        readonly && 'cursor-default',
      )}
    >
      <div className="relative size-4 shrink-0">
        <InputField
          className={cn(
            'size-4 text-text-accent',
            !readonly && !!dragHandleProps && 'group-focus-within:opacity-0 group-hover:opacity-0',
          )}
        />
        {!readonly && dragHandleProps && (
          <IconButton
            {...dragHandleProps}
            className="handle pointer-events-none absolute -top-1 -left-1 size-6 cursor-grab opacity-0 group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100 aria-pressed:bg-state-accent-hover"
          >
            <RiDraggable aria-hidden="true" className="size-4 text-text-quaternary" />
          </IconButton>
        )}
      </div>
      <div className="flex grow basis-0 items-center gap-x-1 overflow-hidden">
        <div
          id={fieldNameId}
          title={payload.variable}
          className="max-w-32.5 shrink-0 truncate system-sm-medium text-text-secondary"
        >
          {payload.variable}
        </div>
        {payload.label && (
          <>
            <div className="shrink-0 system-xs-regular text-text-quaternary">·</div>
            <div
              title={payload.label}
              className="grow truncate system-xs-medium text-text-tertiary"
            >
              {payload.label}
            </div>
          </>
        )}
      </div>
      {!readonly && (
        <div className="flex shrink-0 items-center gap-x-1">
          {dragHandleProps && (
            <>
              <IconButton
                aria-label={t(($) => $['operation.moveUp'], { ns: 'common' })}
                aria-describedby={fieldNameId}
                disabled={!onMoveUp}
                onClick={onMoveUp}
              >
                <RiArrowUpLine aria-hidden="true" className="size-4" />
              </IconButton>
              <IconButton
                aria-label={t(($) => $['operation.moveDown'], { ns: 'common' })}
                aria-describedby={fieldNameId}
                disabled={!onMoveDown}
                onClick={onMoveDown}
              >
                <RiArrowDownLine aria-hidden="true" className="size-4" />
              </IconButton>
            </>
          )}
          <IconButton
            aria-describedby={fieldNameId}
            aria-label={t(($) => $['operation.edit'], { ns: 'common' })}
            onClick={handleOnClickEdit}
          >
            <RiEditLine aria-hidden="true" className="size-4 text-text-tertiary" />
          </IconButton>
          <IconButton
            aria-describedby={fieldNameId}
            aria-label={t(($) => $['operation.remove'], { ns: 'common' })}
            onClick={handleRemove}
          >
            <RiDeleteBinLine
              aria-hidden="true"
              className="size-4 text-text-tertiary group-hover:text-text-destructive"
            />
          </IconButton>
        </div>
      )}
      <div className="flex shrink-0 items-center gap-x-2">
        {payload.required && (
          <Badge>{t(($) => $['nodes.start.required'], { ns: 'workflow' })}</Badge>
        )}
        <InputVarTypeIcon
          type={payload.type as unknown as InputVarType}
          className="size-3 text-text-tertiary"
        />
      </div>
    </div>
  )
}
export default React.memo(FieldItem)
