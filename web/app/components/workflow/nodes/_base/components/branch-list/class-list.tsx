'use client'
import type { FC, ReactNode } from 'react'
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
import { useKeyboardSortable } from '@/app/components/base/keyboard-sortable/use-keyboard-sortable'
import { useEdgesInteractions } from '../../../../hooks/use-edges-interactions'
import AddButton from '../add-button'
import {
  Collapse,
  CollapseActions,
  CollapseContent,
  CollapseHeader,
  CollapseIndicator,
  CollapseTitle,
  CollapseTrigger,
} from '../collapse'
import Item from './class-item'
import { getDefaultClassLabel, isDefaultClassLabel } from './class-label-utils'
import { useInlineLabelHintDismissed } from './storage'

const i18nPrefix = 'nodes.questionClassifiers'
type Props = Readonly<{
  nodeId: string
  list: Topic[]
  minItems?: number
  enabled?: boolean
  actions?: ReactNode
  onChange: (list: Topic[]) => void
  /** Owns both the list update and edge removal instead of the default removal action. */
  onRemove?: (id: string) => void
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
  minItems = 0,
  enabled = true,
  actions,
  onChange,
  onRemove,
  readonly,
  filterVar,
  labels,
  handleSortTopic = noop,
}) => {
  const { t } = useTranslation(['workflow', 'workflowModels'])
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
  }, [list, onChange, t, labels])

  const handleRemoveClass = useCallback(
    (index: number) => {
      return () => {
        if (list.length <= minItems) return
        if (onRemove) {
          onRemove(list[index]!.id)
          return
        }
        const newList = produce(list, (draft) => {
          draft.splice(index, 1)
        })
        onChange(newList)
        handleEdgeDeleteByDeleteBranch(nodeId, list[index]!.id)
      }
    },
    [list, minItems, onChange, onRemove, handleEdgeDeleteByDeleteBranch, nodeId],
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
    <Collapse collapsed={!enabled || collapsed} onCollapse={setCollapsed} disabled={!enabled}>
      {keyboardSort.announcement}
      <CollapseHeader>
        <CollapseTrigger className="ml-0">
          <CollapseTitle>
            {labels?.title ?? t(($) => $[`${i18nPrefix}.class`], { ns: 'workflow' })}{' '}
            {enabled && <span className="text-text-destructive">*</span>}
          </CollapseTitle>
          {enabled && list.length > 0 && <CollapseIndicator />}
        </CollapseTrigger>
        {actions != null && <CollapseActions>{actions}</CollapseActions>}
      </CollapseHeader>
      {enabled && (
        <CollapseContent>
          <div className="pt-2">
            {shouldShowRenameHint && (
              <div className="mb-2 rounded-lg border border-divider-subtle bg-components-panel-bg px-3 py-2 text-xs text-text-tertiary">
                {labels?.renameHint ??
                  t(($) => $[`${i18nPrefix}.renameHint`], { ns: 'workflowModels' })}
              </div>
            )}

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
                            className="handle pointer-events-none absolute top-1.5 left-0.5 z-10 opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 focus:pointer-events-auto focus:opacity-100 aria-pressed:pointer-events-auto aria-pressed:opacity-100"
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
                          showRemove={list.length > minItems}
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
            {!readonly && (
              <div className="mt-2">
                <AddButton
                  onClick={handleAddClass}
                  text={
                    labels?.add ?? t(($) => $[`${i18nPrefix}.addClass`], { ns: 'workflowModels' })
                  }
                />
              </div>
            )}
          </div>
        </CollapseContent>
      )}
    </Collapse>
  )
}
export default React.memo(ClassList)
