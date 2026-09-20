'use client'
import type { FC } from 'react'
import type { Topic } from './types'
import type { ValueSelector, Var } from '@/app/components/workflow/types'
import { cn } from '@langgenius/dify-ui/cn'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { noop } from 'es-toolkit/function'
import { produce } from 'immer'
import * as React from 'react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ReactSortable } from 'react-sortablejs'
import { ArrowDownRoundFill } from '@/app/components/base/icons/src/vender/solid/general'
import { useKeyboardSortable } from '@/app/components/base/keyboard-sortable/use-keyboard-sortable'
import { useEdgesInteractions } from '../../../../hooks/use-edges-interactions'
import AddButton from '../add-button'
import Item from './class-item'
import { getDefaultClassLabel, isDefaultClassLabel } from './class-label-utils'
import { useInlineLabelHintDismissed } from './storage'

const i18nPrefix = 'nodes.questionClassifiers'
type Props = Readonly<{
  nodeId: string
  list: Topic[]
  onChange: (list: Topic[]) => void
  readonly?: boolean
  filterVar: (payload: Var, valueSelector: ValueSelector) => boolean
  labels?: {
    title: string
    add: string
    placeholder: string
    renameHint: string
    defaultLabel: (index: number) => string
  }
  handleSortTopic?: (newTopics: (Topic & { id: string })[]) => void
}>

const ClassList: FC<Props> = ({
  nodeId,
  list,
  onChange,
  readonly,
  filterVar,
  labels,
  handleSortTopic = noop,
}) => {
  const { t } = useTranslation()
  const { handleEdgeDeleteByDeleteBranch } = useEdgesInteractions()
  const [collapsed, setCollapsed] = useState(false)
  const [storedRenameHintDismissed, setIsRenameHintDismissed] = useInlineLabelHintDismissed()
  const isRenameHintDismissed = storedRenameHintDismissed ?? false

  const handleClassChange = useCallback(
    (index: number) => {
      return (value: Topic) => {
        const newList = produce(list, (draft) => {
          draft[index] = value
        })
        onChange(newList)
      }
    },
    [list, onChange],
  )

  const handleAddClass = useCallback(() => {
    const newList = produce(list, (draft) => {
      draft.push({
        id: crypto.randomUUID(),
        name: '',
        label: labels?.defaultLabel(draft.length + 1) ?? getDefaultClassLabel(t, draft.length + 1),
      })
    })
    onChange(newList)
    if (collapsed) setCollapsed(false)
  }, [collapsed, list, onChange, t, labels])

  const handleRemoveClass = useCallback(
    (index: number) => {
      return () => {
        const newList = produce(list, (draft) => {
          draft.splice(index, 1)
        })
        onChange(newList)
        handleEdgeDeleteByDeleteBranch(nodeId, list[index]!.id)
      }
    },
    [list, onChange, handleEdgeDeleteByDeleteBranch, nodeId],
  )

  const keyboardSort = useKeyboardSortable({
    items: list,
    onChange: handleSortTopic,
    disabled: readonly,
    getItemLabel: (item) => item.label || item.name,
  })
  const sortableTopics = useMemo(
    () => keyboardSort.items.map((item) => ({ ...item })),
    [keyboardSort.items],
  )

  const topicCount = list.length

  const handleCollapse = useCallback(() => {
    setCollapsed(!collapsed)
  }, [collapsed])

  const dismissRenameHint = useCallback(() => {
    if (isRenameHintDismissed) return

    setIsRenameHintDismissed(true)
  }, [isRenameHintDismissed, setIsRenameHintDismissed])

  const shouldShowRenameHint =
    !readonly &&
    !isRenameHintDismissed &&
    list.some((item, index) => {
      return labels
        ? item.label === labels.defaultLabel(index + 1)
        : isDefaultClassLabel(item.label, index + 1, t)
    })

  return (
    <>
      {keyboardSort.announcement}
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          className="flex cursor-pointer items-center border-none bg-transparent p-0 text-left text-xs font-semibold text-text-secondary uppercase focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden"
          onClick={handleCollapse}
        >
          {labels?.title ?? t(($) => $[`${i18nPrefix}.class`], { ns: 'workflow' })}{' '}
          <span className="text-text-destructive">*</span>
          {list.length > 0 && (
            <ArrowDownRoundFill
              className={cn(
                'size-4 text-text-quaternary transition-transform duration-200',
                collapsed && '-rotate-90',
              )}
              aria-hidden="true"
            />
          )}
        </button>
      </div>
      {shouldShowRenameHint && (
        <div className="mb-2 rounded-lg border border-divider-subtle bg-components-panel-bg px-3 py-2 text-xs text-text-tertiary">
          {labels?.renameHint ?? t(($) => $[`${i18nPrefix}.renameHint`], { ns: 'workflow' })}
        </div>
      )}

      {!collapsed && (
        <div className="overflow-y-visible pl-3">
          <ReactSortable
            list={sortableTopics}
            setList={(items) => {
              if (
                !keyboardSort.isSorting &&
                items.some((item, index) => item.id !== sortableTopics[index]?.id)
              )
                handleSortTopic(items)
            }}
            handle=".handle"
            ghostClass="bg-components-panel-bg"
            animation={150}
            disabled={readonly || keyboardSort.isSorting}
            className="space-y-2"
          >
            {keyboardSort.items.map((item, index) => {
              const canDrag = !readonly && topicCount >= 2
              return (
                <div
                  key={item.id}
                  className={cn(
                    'group relative -ml-3 min-h-10 rounded-[10px] bg-components-panel-bg px-0 py-0',
                  )}
                  style={{
                    // Performance hint for browser
                    contain: 'layout style paint',
                  }}
                >
                  <div>
                    {canDrag && (
                      <IconButton
                        {...keyboardSort.getHandleProps(index)}
                        className="handle pointer-events-none absolute top-1.5 left-0.5 z-10 size-6 opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 focus:pointer-events-auto focus:opacity-100 aria-pressed:pointer-events-auto aria-pressed:opacity-100"
                      >
                        <span aria-hidden="true" className="i-ri-draggable size-3" />
                      </IconButton>
                    )}
                    <Item
                      className={cn(canDrag && 'handle')}
                      headerClassName={cn(
                        canDrag && 'cursor-grab group-focus-within:pl-5 group-hover:pl-5',
                      )}
                      nodeId={nodeId}
                      key={item.id}
                      payload={item}
                      onChange={handleClassChange(keyboardSort.getItemKey(index))}
                      onRemove={handleRemoveClass(keyboardSort.getItemKey(index))}
                      index={index + 1}
                      readonly={readonly}
                      filterVar={filterVar}
                      onLabelEditStart={dismissRenameHint}
                      placeholder={labels?.placeholder}
                      defaultLabel={labels?.defaultLabel(index + 1)}
                    />
                  </div>
                </div>
              )
            })}
          </ReactSortable>
        </div>
      )}
      {!readonly && !collapsed && (
        <div className="mt-2">
          <AddButton
            onClick={handleAddClass}
            text={labels?.add ?? t(($) => $[`${i18nPrefix}.addClass`], { ns: 'workflow' })}
          />
        </div>
      )}
    </>
  )
}
export default React.memo(ClassList)
