'use client'
import type { FC } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { RiAddLine, RiDeleteBinLine, RiDraggable } from '@remixicon/react'
import * as React from 'react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ReactSortable } from 'react-sortablejs'
import { useKeyboardSortable } from '@/app/components/base/keyboard-sortable/use-keyboard-sortable'

export type Options = string[]
type IConfigSelectProps = {
  options: Options
  onChange: (options: Options) => void
  errorMessage?: string
  errorId?: string
}

const ConfigSelect: FC<IConfigSelectProps> = ({ options, onChange, errorMessage, errorId }) => {
  const { t } = useTranslation()
  const [focusID, setFocusID] = useState<number | null>(null)
  const [deletingID, setDeletingID] = useState<number | null>(null)

  const { items, getHandleProps, getItemKey, isSorting, announcement } = useKeyboardSortable({
    items: options,
    onChange,
    getItemLabel: (item) => item,
  })
  const optionList = useMemo(() => items.map((name, index) => ({ id: index, name })), [items])

  return (
    <div>
      {announcement}
      {options.length > 0 && (
        <div className="mb-1">
          <ReactSortable
            className="space-y-1"
            list={optionList}
            setList={(list) => {
              if (!isSorting && list.some((item, index) => item.name !== options[index]))
                onChange(list.map((item) => item.name))
            }}
            disabled={isSorting}
            handle=".handle"
            ghostClass="opacity-50"
            animation={150}
          >
            {items.map((o, index) => (
              <div
                className={cn(
                  'group relative flex items-center rounded-lg border border-components-panel-border-subtle bg-components-panel-on-panel-item-bg pl-2.5 hover:bg-components-panel-on-panel-item-bg-hover',
                  focusID === index &&
                    'border-components-input-border-active bg-components-input-bg-active hover:border-components-input-border-active hover:bg-components-input-bg-active',
                  deletingID === index &&
                    'border-components-input-border-destructive bg-state-destructive-hover hover:border-components-input-border-destructive hover:bg-state-destructive-hover',
                )}
                key={getItemKey(index)}
              >
                <IconButton
                  {...getHandleProps(index)}
                  className="handle size-6 shrink-0 cursor-grab aria-pressed:bg-state-accent-hover"
                >
                  <RiDraggable aria-hidden="true" className="size-4 text-text-quaternary" />
                </IconButton>
                <input
                  key={getItemKey(index)}
                  type="input"
                  aria-label={`${t(($) => $['variableConfig.options'], { ns: 'appDebug' })} ${index + 1}`}
                  aria-invalid={!!errorMessage || undefined}
                  aria-describedby={errorMessage ? errorId : undefined}
                  value={o || ''}
                  onChange={(e) => {
                    const value = e.target.value
                    onChange(
                      options.map((item, i) => {
                        if (getItemKey(index) === i) return value

                        return item
                      }),
                    )
                  }}
                  className="h-9 w-full grow cursor-pointer overflow-x-auto rounded-lg border-0 bg-transparent pr-8 pl-1.5 text-sm/9 text-text-secondary focus:outline-hidden"
                  onFocus={() => setFocusID(index)}
                  onBlur={() => setFocusID(null)}
                />
                <button
                  type="button"
                  aria-label={t(($) => $['operation.delete'], { ns: 'common' })}
                  className="absolute top-1/2 right-1.5 block translate-y-[-50%] cursor-pointer rounded-md border-none bg-transparent p-1 text-text-tertiary hover:bg-state-destructive-hover hover:text-text-destructive focus-visible:ring-1 focus-visible:ring-state-destructive-border focus-visible:outline-hidden"
                  onClick={() => {
                    onChange(options.filter((_, i) => getItemKey(index) !== i))
                    setDeletingID(null)
                  }}
                  onMouseEnter={() => setDeletingID(index)}
                  onMouseLeave={() => setDeletingID(null)}
                >
                  <RiDeleteBinLine className="size-3.5" aria-hidden="true" />
                </button>
              </div>
            ))}
          </ReactSortable>
        </div>
      )}

      <Button
        type="button"
        variant="tertiary"
        aria-invalid={(options.length === 0 && !!errorMessage) || undefined}
        aria-describedby={options.length === 0 && errorMessage ? errorId : undefined}
        onClick={() => {
          onChange([...options, ''])
        }}
        className="mt-1 flex h-9 w-full justify-start gap-2 px-3"
      >
        <RiAddLine aria-hidden="true" className="size-4" />
        <span className="system-sm-medium text-[13px]">
          {t(($) => $['variableConfig.addOption'], { ns: 'appDebug' })}
        </span>
      </Button>
    </div>
  )
}

export default React.memo(ConfigSelect)
