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
}

const Field: FC<Props> = ({
  name,
  payload,
  depth = 1,
  required,
}) => {
  const { t } = useTranslation()
  const hasChildren = payload.type === Type.object && payload.properties
  const [fold, {
    toggle: toggleFold,
  }] = useBoolean(false)
  return (
    <div>
      <div className={cn('flex pr-2')}>
        <TreeIndentLine depth={depth} />
        <div className='grow'>
          <div className='flex relative select-none'>
            {hasChildren && (
              <RiArrowDropDownLine
                className={cn('absolute top-[50%] translate-y-[-50%] left-[-18px] bg-components-panel-bg w-4 h-4 text-text-tertiary cursor-pointer', fold && 'rotate-[270deg] text-text-accent')}
                onClick={toggleFold}
              />
            )}
            <div className='h-6 truncate system-sm-medium text-text-secondary leading-6'>{name}</div>
            <div className='ml-3 shrink-0 system-xs-regular text-text-tertiary leading-6'>{getFieldType(payload)}</div>
            {required && <div className='ml-3 text-text-warning system-2xs-medium-uppercase leading-6'>{t('app.structOutput.required')}</div>}
          </div>
          {payload.description && (
            <div className='flex'>
              <div className='w-0 grow system-xs-regular text-text-tertiary truncate'>{payload.description}</div>
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
