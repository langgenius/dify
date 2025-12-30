'use client'
import type { FC } from 'react'
import type { Field as FieldType } from '../../../../../llm/types'
import type { ValueSelector } from '@/app/components/workflow/types'
import { RiMoreFill } from '@remixicon/react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Tooltip from '@/app/components/base/tooltip'
import { cn } from '@/utils/classnames'
import { Type } from '../../../../../llm/types'
import { getFieldType } from '../../../../../llm/utils'
import TreeIndentLine from '../tree-indent-line'

const MAX_DEPTH = 10

type Props = {
  valueSelector: ValueSelector
  name: string
  payload: FieldType
  depth?: number
  readonly?: boolean
  onSelect?: (valueSelector: ValueSelector) => void
}

const Field: FC<Props> = ({
  valueSelector,
  name,
  payload,
  depth = 1,
  readonly,
  onSelect,
}) => {
  const { t } = useTranslation()
  const isLastFieldHighlight = readonly
  const hasChildren = payload.type === Type.object && payload.properties
  const isHighlight = isLastFieldHighlight && !hasChildren
  if (depth > MAX_DEPTH + 1)
    return null
  return (
    <div>
      <Tooltip popupContent={t('structOutput.moreFillTip', { ns: 'app' })} disabled={depth !== MAX_DEPTH + 1}>
        <div
          className={cn('flex items-center justify-between rounded-md pr-2', !readonly && 'hover:bg-state-base-hover', depth !== MAX_DEPTH + 1 && 'cursor-pointer')}
          onMouseDown={() => !readonly && onSelect?.([...valueSelector, name])}
        >
          <div className="flex grow items-stretch">
            <TreeIndentLine depth={depth} />
            {depth === MAX_DEPTH + 1
              ? (
                  <RiMoreFill className="h-3 w-3 text-text-tertiary" />
                )
              : (<div className={cn('system-sm-medium h-6 w-0 grow truncate leading-6 text-text-secondary', isHighlight && 'text-text-accent')}>{name}</div>)}

          </div>
          {depth < MAX_DEPTH + 1 && (
            <div className="system-xs-regular ml-2 shrink-0 text-text-tertiary">{getFieldType(payload)}</div>
          )}
        </div>
      </Tooltip>

      {depth <= MAX_DEPTH && payload.type === Type.object && payload.properties && (
        <div>
          {Object.keys(payload.properties).map(propName => (
            <Field
              key={propName}
              name={propName}
              payload={payload.properties?.[propName] as FieldType}
              depth={depth + 1}
              readonly={readonly}
              valueSelector={[...valueSelector, name]}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  )
}
export default React.memo(Field)
