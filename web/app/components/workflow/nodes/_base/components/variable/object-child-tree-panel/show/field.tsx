'use client'
import type { FC } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { RiArrowDropDownLine } from '@remixicon/react'
import * as React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Type } from '../../../../../llm/types'
import TreeIndentLine from '../tree-indent-line'

type Props = Readonly<{
  name: string
  payload: unknown
  required: boolean
  depth?: number
  rootClassName?: string
}>

const Field: FC<Props> = ({ name, payload, depth = 1, required, rootClassName }) => {
  const { t } = useTranslation(['app'])
  const isRoot = depth === 1
  const schema = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {}
  const type =
    'type' in schema && typeof schema.type === 'string' && schema.type ? schema.type : 'Unknown'
  const properties =
    'properties' in schema &&
    schema.properties &&
    typeof schema.properties === 'object' &&
    !Array.isArray(schema.properties)
      ? schema.properties
      : undefined
  const requiredProperties =
    'required' in schema && Array.isArray(schema.required) ? schema.required : []
  const description =
    'description' in schema && typeof schema.description === 'string' ? schema.description : ''
  const schemaType =
    'schemaType' in schema && typeof schema.schemaType === 'string' ? schema.schemaType : ''
  const enumValues =
    'enum' in schema && Array.isArray(schema.enum)
      ? schema.enum.filter(
          (value): value is string | number =>
            typeof value === 'string' || typeof value === 'number',
        )
      : []
  const items = 'items' in schema ? schema.items : undefined
  const itemType =
    items &&
    typeof items === 'object' &&
    'type' in items &&
    typeof items.type === 'string' &&
    items.type
      ? items.type
      : 'Unknown'
  const displayType =
    schemaType === 'file'
      ? Type.file
      : enumValues.length > 0
        ? Type.enumType
        : type === Type.array && items
          ? `array[${itemType}]`
          : type
  const hasChildren = type === Type.object && properties
  const [fold, setFold] = useState(false)
  return (
    <div>
      <div className={cn('flex pr-2')}>
        <TreeIndentLine depth={depth} />
        <div className="w-0 grow">
          <div className="relative flex select-none">
            {hasChildren && (
              <RiArrowDropDownLine
                className={cn(
                  'absolute top-[50%] -left-4.5 h-4 w-4 translate-y-[-50%] cursor-pointer bg-components-panel-bg text-text-tertiary',
                  fold && 'rotate-270 text-text-accent',
                )}
                onClick={() => setFold((isFolded) => !isFolded)}
              />
            )}
            <div
              className={cn(
                'ml-1.75 h-6 truncate system-sm-medium leading-6 text-text-secondary',
                isRoot && rootClassName,
              )}
            >
              {name}
            </div>
            <div className="ml-3 shrink-0 system-xs-regular leading-6 text-text-tertiary">
              {displayType}
              {schemaType && schemaType !== 'file' && ` (${schemaType})`}
            </div>
            {required && (
              <div className="ml-3 system-2xs-medium-uppercase leading-6 text-text-warning">
                {t(($) => $['structOutput.required'], { ns: 'app' })}
              </div>
            )}
          </div>
          {description && (
            <div className="ml-1.75 flex">
              <div className="w-0 grow truncate system-xs-regular text-text-tertiary">
                {description}
              </div>
            </div>
          )}
          {enumValues.length > 0 && (
            <div className="ml-1.75 flex">
              <div className="w-0 grow system-xs-regular text-text-quaternary">
                {enumValues.map((value, index) => (
                  <span key={index}>
                    {typeof value === 'string' ? `"${value}"` : value}
                    {index < enumValues.length - 1 && ' | '}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {hasChildren && !fold && (
        <div>
          {Object.entries(properties).map(([name, value]: [string, unknown]) => (
            <Field
              key={name}
              name={name}
              payload={value}
              depth={depth + 1}
              required={requiredProperties.includes(name)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
export default React.memo(Field)
