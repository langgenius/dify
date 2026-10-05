'use client'
import type { FC, Ref } from 'react'
import type { InputVar } from '@/app/components/workflow/types'
import { cn } from '@langgenius/dify-ui/cn'
import { RiDeleteBinLine } from '@remixicon/react'
import { noop } from 'es-toolkit/function'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Badge from '@/app/components/base/badge'
import InputVarTypeIcon from '../../_base/components/input-var-type-icon'

type Props = Readonly<{
  className?: string
  readonly: boolean
  payload: InputVar
  onEdit?: () => void
  editButtonRef?: Ref<HTMLButtonElement>
  onRemove?: () => void
  rightContent?: React.JSX.Element
  showLegacyBadge?: boolean
  canDrag?: boolean
}>

const VarItem: FC<Props> = ({
  className,
  readonly,
  payload,
  onEdit = noop,
  editButtonRef,
  onRemove = noop,
  rightContent,
  showLegacyBadge = false,
  canDrag,
}) => {
  const { t } = useTranslation(['common', 'workflow'])

  return (
    <div
      className={cn(
        'group relative flex h-8 cursor-pointer items-center justify-between rounded-lg border border-components-panel-border-subtle bg-components-panel-on-panel-item-bg px-2.5 shadow-xs hover:shadow-md',
        className,
      )}
    >
      <div className="flex w-0 grow items-center space-x-1">
        <span
          aria-hidden
          className={cn(
            'i-custom-vender-solid-development-variable-02 h-6 w-6',
            cn(
              'size-3.5 text-text-accent',
              canDrag &&
                'group-hover:opacity-0 group-has-[.handle:focus]:opacity-0 group-has-[.handle[aria-pressed=true]]:opacity-0',
            ),
          )}
        />
        <div
          title={payload.variable}
          className="max-w-32.5 shrink-0 truncate text-[13px] font-medium text-text-secondary"
        >
          {payload.variable}
        </div>
        {payload.label && (
          <>
            <div className="shrink-0 text-xs font-medium text-text-quaternary">·</div>
            <div
              title={payload.label as string}
              className="max-w-32.5 truncate text-[13px] font-medium text-text-tertiary"
            >
              {payload.label as string}
            </div>
          </>
        )}
        {showLegacyBadge && (
          <Badge
            text="LEGACY"
            className="shrink-0 border-text-accent-secondary text-text-accent-secondary"
          />
        )}
      </div>
      <div className="ml-2 flex shrink-0 items-center">
        {rightContent || (
          <>
            <div
              className={cn(
                'flex items-center',
                !readonly && 'group-focus-within:hidden group-hover:hidden',
              )}
            >
              {payload.required && (
                <div className="mr-2 text-xs font-normal text-text-tertiary">
                  {t(($) => $['nodes.start.required'], { ns: 'workflow' })}
                </div>
              )}
              <InputVarTypeIcon type={payload.type} className="size-3.5 text-text-tertiary" />
            </div>
            {!readonly && (
              <div className="pointer-events-none flex w-0 items-center overflow-hidden opacity-0 group-focus-within:pointer-events-auto group-focus-within:w-auto group-focus-within:overflow-visible group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:w-auto group-hover:overflow-visible group-hover:opacity-100">
                <button
                  type="button"
                  aria-label={t(($) => $['operation.edit'], { ns: 'common' })}
                  className="mr-1 cursor-pointer rounded-md border-none bg-transparent p-1 hover:bg-state-base-hover focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden"
                  ref={editButtonRef}
                  onClick={onEdit}
                >
                  <span
                    aria-hidden="true"
                    className="i-custom-vender-solid-general-edit-03 size-4 text-text-tertiary"
                  />
                </button>
                <button
                  type="button"
                  aria-label={t(($) => $['operation.remove'], { ns: 'common' })}
                  className="group cursor-pointer rounded-md border-none bg-transparent p-1 hover:bg-state-destructive-hover focus-visible:ring-1 focus-visible:ring-state-destructive-border focus-visible:outline-hidden"
                  onClick={onRemove}
                >
                  <RiDeleteBinLine
                    className="size-4 text-text-tertiary group-hover:text-text-destructive"
                    aria-hidden="true"
                  />
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
export default React.memo(VarItem)
