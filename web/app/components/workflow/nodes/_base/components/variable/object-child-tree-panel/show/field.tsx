'use client'
import type { FC } from 'react'
import type { Field as FieldType } from '../../../../../llm/types'
import { RiArrowDropDownLine } from '@remixicon/react'
import { useBoolean } from 'ahooks'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/utils/classnames'
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
                className={cn('absolute left-[-18px] top-[50%] h-4 w-4 translate-y-[-50%] cursor-pointer bg-components-panel-bg text-text-tertiary', fold && 'rotate-[270deg] text-text-accent')}
                onClick={toggleFold}
              />
            )}
            <div className={cn('ml-[7px] h-6 truncate leading-6 text-text-secondary system-sm-medium', isRoot && rootClassName)}>{name}</div>
            <div className="ml-3 shrink-0 leading-6 text-text-tertiary system-xs-regular">
              {getFieldType(payload)}
              {(payload.schemaType && payload.schemaType !== 'file' && ` (${payload.schemaType})`)}
            </div>
            {required && <div className="ml-3 leading-6 text-text-warning system-2xs-medium-uppercase">{t('structOutput.required', { ns: 'app' })}</div>}
          </div>
          {payload.description && (
            <div className="ml-[7px] flex">
              <div className="w-0 grow truncate text-text-tertiary system-xs-regular">{payload.description}</div>
            </div>
          )}
          {hasEnum && (
            <div className="ml-[7px] flex">
              <div className="w-0 grow text-text-quaternary system-xs-regular">
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
