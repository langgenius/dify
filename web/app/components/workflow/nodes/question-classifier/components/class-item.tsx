'use client'
import type { FC } from 'react'
import type { Topic } from '../types'
import type { ValueSelector, Var } from '@/app/components/workflow/types'
import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Editor from '@/app/components/workflow/nodes/_base/components/prompt/editor'
import useAvailableVarList from '@/app/components/workflow/nodes/_base/hooks/use-available-var-list'
import { getCanonicalClassLabel, getDisplayClassLabel } from './class-label-utils'

const i18nPrefix = 'nodes.questionClassifiers'

type Props = {
  className?: string
  headerClassName?: string
  nodeId: string
  payload: Topic
  onChange: (payload: Topic) => void
  onRemove: () => void
  index: number
  readonly?: boolean
  filterVar: (payload: Var, valueSelector: ValueSelector) => boolean
  onLabelEditStart?: () => void
}

const ClassItem: FC<Props> = ({
  className,
  headerClassName,
  nodeId,
  payload,
  onChange,
  onRemove,
  index,
  readonly,
  filterVar,
  onLabelEditStart,
}) => {
  const { t } = useTranslation()
  const reactId = useId()
  const [isEditingLabel, setIsEditingLabel] = useState(false)
  const [draftLabel, setDraftLabel] = useState('')
  const labelInputRef = useRef<HTMLInputElement>(null)
  const displayLabel = getDisplayClassLabel(payload.label, index, t)
  const instanceId = `${nodeId}-${reactId}`

  useEffect(() => {
    if (isEditingLabel)
      labelInputRef.current?.select()
  }, [isEditingLabel])

  const handleNameChange = useCallback((value: string) => {
    onChange({ ...payload, name: value })
  }, [onChange, payload])

  const handleLabelSave = useCallback((nextValue: string) => {
    const normalizedLabel = getCanonicalClassLabel(nextValue, index, t)
    setIsEditingLabel(false)
    setDraftLabel(normalizedLabel)
    const shouldPersistLabel = normalizedLabel !== displayLabel
      || (payload.label !== undefined && payload.label !== normalizedLabel)
    if (shouldPersistLabel)
      onChange({ ...payload, label: normalizedLabel })
  }, [displayLabel, index, onChange, payload, t])

  const handleLabelCancel = useCallback(() => {
    setDraftLabel(displayLabel)
    setIsEditingLabel(false)
  }, [displayLabel])

  const handleLabelEditStart = useCallback(() => {
    if (readonly)
      return

    setDraftLabel(displayLabel)
    setIsEditingLabel(true)
    onLabelEditStart?.()
  }, [displayLabel, onLabelEditStart, readonly])

  const { availableVars, availableNodesWithParent } = useAvailableVarList(nodeId, {
    onlyLeafNodeVar: false,
    hideChatVar: false,
    hideEnv: false,
    filterVar,
  })

  const title = isEditingLabel
    ? (
        <input
          ref={labelInputRef}
          value={draftLabel}
          aria-label={t(`${i18nPrefix}.labelEditorAriaLabel`, { ns: 'workflow' })}
          className={cn(
            'h-6 w-full rounded-md border border-divider-regular bg-components-input-bg-normal px-2 text-xs font-semibold text-text-secondary ring-0 outline-none',
            'focus:border-components-input-border-active',
          )}
          onChange={event => setDraftLabel(event.target.value)}
          onBlur={() => handleLabelSave(draftLabel)}
          onClick={event => event.stopPropagation()}
          onDoubleClick={event => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              handleLabelSave(draftLabel)
            }

            if (event.key === 'Escape') {
              event.preventDefault()
              handleLabelCancel()
            }
          }}
          autoFocus
        />
      )
    : readonly
      ? (
          <div className="-ml-1 px-1 py-0.5 text-left text-xs leading-4 font-semibold text-text-secondary">
            {displayLabel}
          </div>
        )
      : (
          <button
            type="button"
            aria-label={displayLabel}
            className={cn(
              '-ml-1 rounded px-1 py-0.5 text-left text-xs leading-4 font-semibold text-text-secondary transition-colors',
              'cursor-text hover:bg-state-base-hover',
            )}
            onDoubleClick={handleLabelEditStart}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                handleLabelEditStart()
              }
            }}
          >
            {displayLabel}
          </button>
        )

  return (
    <Editor
      className={className}
      headerClassName={headerClassName}
      title={title}
      placeholder={t(`${i18nPrefix}.topicPlaceholder`, { ns: 'workflow' })!}
      value={payload.name}
      onChange={handleNameChange}
      showRemove
      onRemove={onRemove}
      nodesOutputVars={availableVars}
      availableNodes={availableNodesWithParent}
      readOnly={readonly} // ?
      instanceId={instanceId}
      justVar // ?
      isSupportFileVar // ?
    />
  )
}
export default React.memo(ClassItem)
