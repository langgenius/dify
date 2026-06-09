'use client'
import type { FC } from 'react'
import type { Field as FieldType } from '../../../../../llm/types'
import { cn } from '@langgenius/dify-ui/cn'
import { RiArrowDropDownLine } from '@remixicon/react'
import { useBoolean } from 'ahooks'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Type } from '../../../../../llm/types'
import { getFieldType } from '../../../../../llm/utils'
import TreeIndentLine from '../tree-indent-line'

type Props = {
  name: string
  payload: FieldType
  required: boolean
  depth?: number
  rootClassName?: string
}

const Field: FC<Props> = ({
  name,
  payload,
  depth = 1,
  required,
  rootClassName,
}) => {
  const { t } = useTranslation()
  const isRoot = depth === 1
  const hasChildren = payload.type === Type.object && payload.properties
  const hasEnum = payload.enum && payload.enum.length > 0
  const [fold, {
    toggle: toggleFold,
  }] = useBoolean(false)
  return (
    <div>
      <div className={cn('flex pr-2')}>
        <TreeIndentLine depth={depth} />
        <div className="w-0 grow">
          <div className="relative flex select-none">
            {hasChildren && (
              <RiArrowDropDownLine
                className={cn('absolute top-[50%] left-[-18px] h-4 w-4 translate-y-[-50%] cursor-pointer bg-components-panel-bg text-text-tertiary', fold && 'rotate-270 text-text-accent')}
                onClick={toggleFold}
              />
            )}
            <div className={cn('ml-[7px] h-6 truncate system-sm-medium leading-6 text-text-secondary', isRoot && rootClassName)}>{name}</div>
            <div className="ml-3 shrink-0 system-xs-regular leading-6 text-text-tertiary">
              {getFieldType(payload)}
              {(payload.schemaType && payload.schemaType !== 'file' && ` (${payload.schemaType})`)}
            </div>
            {required && <div className="ml-3 system-2xs-medium-uppercase leading-6 text-text-warning">{t('structOutput.required', { ns: 'app' })}</div>}
          </div>
          {payload.description && (
            <div className="ml-[7px] flex">
              <div className="w-0 grow truncate system-xs-regular text-text-tertiary">{payload.description}</div>
            </div>
          )}
          {hasEnum && (
            <div className="ml-[7px] flex">
              <div className="w-0 grow system-xs-regular text-text-quaternary">
                {payload.enum!.map((value, index) => (
                  <span key={index}>
                    {typeof value === 'string' ? `"${value}"` : value}
                    {index < payload.enum!.length - 1 && ' | '}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {hasChildren && !fold && (
        <div>
          {Object.keys(payload.properties!).map(name => (
            <Field
              key={name}
              name={name}
              payload={payload.properties?.[name] as FieldType}
              depth={depth + 1}
              required={!!payload.required?.includes(name)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
export default React.memo(Field)
