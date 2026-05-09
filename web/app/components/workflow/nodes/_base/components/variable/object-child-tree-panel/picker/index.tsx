'use client'
import type { FC } from 'react'
import type { Field as FieldType, StructuredOutput } from '../../../../../llm/types'
import type { ValueSelector } from '@/app/components/workflow/types'
import { cn } from '@langgenius/dify-ui/cn'
import { useHover } from 'ahooks'
import * as React from 'react'
import { useRef } from 'react'
import Field from './field'

type Props = {
  className?: string
  root: { nodeId?: string, nodeName?: string, attrName: string, attrAlias?: string }
  payload: StructuredOutput
  readonly?: boolean
  onSelect?: (valueSelector: ValueSelector) => void
  onHovering?: (value: boolean) => void
  searchText?: string
}

const includesSearchText = (value: string | undefined, searchText: string) => {
  if (!value)
    return false

  return value.toLowerCase().includes(searchText)
}

const getFieldTypeText = (field: FieldType) => {
  if (typeof field.type === 'string')
    return field.type

  return undefined
}

const filterFieldBySearchText = (name: string, field: FieldType, searchText: string): FieldType | undefined => {
  if (!searchText)
    return field

  if (includesSearchText(name, searchText) || includesSearchText(getFieldTypeText(field), searchText))
    return field

  if (!field.properties)
    return undefined

  const filteredProperties = Object.fromEntries(
    Object.entries(field.properties)
      .map(([childName, childField]): [string, FieldType | undefined] => [childName, filterFieldBySearchText(childName, childField, searchText)])
      .filter((entry): entry is [string, FieldType] => !!entry[1]),
  )

  if (Object.keys(filteredProperties).length === 0)
    return undefined

  return {
    ...field,
    properties: filteredProperties,
  }
}

export const PickerPanelMain: FC<Props> = ({
  className,
  root,
  payload,
  readonly,
  onHovering,
  onSelect,
  searchText = '',
}) => {
  const ref = useRef<HTMLDivElement>(null)
  useHover(ref, {
    onChange: (hovering) => {
      if (hovering) {
        onHovering?.(true)
      }
      else {
        setTimeout(() => {
          onHovering?.(false)
        }, 100)
      }
    },
  })
  const schema = payload.schema
  const normalizedSearchText = searchText.trim().toLowerCase()
  const allFields = Object.entries(schema.properties)
  const filteredFields = normalizedSearchText
    ? allFields
      .map(([name, field]): [string, FieldType | undefined] => [name, filterFieldBySearchText(name, field, normalizedSearchText)])
      .filter((entry): entry is [string, FieldType] => !!entry[1])
    : allFields
  const visibleFields = filteredFields.length > 0 ? filteredFields : allFields
  return (
    <div className={cn(className)} ref={ref}>
      {/* Root info */}
      <div className="flex items-center justify-between px-2 py-1">
        <div className="flex">
          {root.nodeName && (
            <>
              <div className="max-w-[100px] truncate system-sm-medium text-text-tertiary">{root.nodeName}</div>
              <div className="system-sm-medium text-text-tertiary">.</div>
            </>
          )}
          <div className="system-sm-medium text-text-secondary">{root.attrName}</div>
        </div>
        <div className="ml-2 truncate system-xs-regular text-text-tertiary" title={root.attrAlias || 'object'}>{root.attrAlias || 'object'}</div>
      </div>
      {visibleFields.map(([name, field]) => (
        <Field
          key={name}
          name={name}
          payload={field}
          readonly={readonly}
          valueSelector={[root.nodeId!, root.attrName]}
          onSelect={onSelect}
        />
      ))}
    </div>
  )
}

const PickerPanel: FC<Props> = ({
  className,
  ...props
}) => {
  return (
    <div className={cn('w-[296px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-1 shadow-lg backdrop-blur-[5px]', className)}>
      <PickerPanelMain {...props} />
    </div>
  )
}
export default React.memo(PickerPanel)
