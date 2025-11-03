'use client'
import type { FC } from 'react'
import React from 'react'
import { Type } from '../../../../../llm/types'
import { getFieldType } from '../../../../../llm/utils'
import type { Field as FieldType } from '../../../../../llm/types'
import cn from '@/utils/classnames'
import TreeIndentLine from '../tree-indent-line'
import { useTranslation } from 'react-i18next'
import { useBoolean } from 'ahooks'
import { RiArrowDropDownLine } from '@remixicon/react'

type Props = {
  name: string,
  payload: FieldType,
  required: boolean,
  depth?: number,
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
  const [fold, {
    toggle: toggleFold,
  }] = useBoolean(false)
  return (
    <div>
      <div className={cn('flex pr-2')}>
        <TreeIndentLine depth={depth} />
        <div className='w-0 grow'>
          <div className='relative flex select-none'>
            {hasChildren && (
              <RiArrowDropDownLine
                className={cn('absolute left-[-18px] top-[50%] h-4 w-4 translate-y-[-50%] cursor-pointer bg-components-panel-bg text-text-tertiary', fold && 'rotate-[270deg] text-text-accent')}
                onClick={toggleFold}
              />
            )}
            <div className={cn('system-sm-medium ml-[7px] h-6 truncate leading-6 text-text-secondary', isRoot && rootClassName)}>{name}</div>
            <div className='system-xs-regular ml-3 shrink-0 leading-6 text-text-tertiary'>{getFieldType(payload)}{(payload.schemaType && payload.schemaType !== 'file' && ` (${payload.schemaType})`)}</div>
            {required && <div className='system-2xs-medium-uppercase ml-3 leading-6 text-text-warning'>{t('app.structOutput.required')}</div>}
          </div>
          {payload.description && (
            <div className='ml-[7px] flex'>
              <div className='system-xs-regular w-0 grow truncate text-text-tertiary'>{payload.description}</div>
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
