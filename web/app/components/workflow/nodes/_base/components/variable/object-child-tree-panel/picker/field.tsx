'use client'
import type { FC } from 'react'
import React from 'react'
import { Type } from '../../../../../llm/types'
import { getFieldType } from '../../../../../llm/utils'
import type { Field as FieldType } from '../../../../../llm/types'
import cn from '@/utils/classnames'
import TreeIndentLine from '../tree-indent-line'
import { RiMoreFill } from '@remixicon/react'
import Tooltip from '@/app/components/base/tooltip'
import { useTranslation } from 'react-i18next'

const MAX_DEPTH = 10

type Props = { name: string, payload: FieldType, depth?: number }

const Field: FC<Props> = ({
  name,
  payload,
  depth = 1,
}) => {
  const { t } = useTranslation()
  if (depth > MAX_DEPTH + 1)
    return null
  return (
    <div>
      <Tooltip popupContent={t('app.structOutput.moreFillTip')} disabled={depth !== MAX_DEPTH + 1}>
        <div className={cn('flex pr-2 items-center justify-between rounded-md hover:bg-state-base-hover', depth !== MAX_DEPTH + 1 && 'cursor-pointer')}>
          <div className='grow flex items-stretch'>
            <TreeIndentLine depth={depth} isMoreFill={depth === MAX_DEPTH + 1} />
            {depth === MAX_DEPTH + 1 ? (
              <RiMoreFill className='w-3 h-3 text-text-tertiary' />
            ) : (<div className='h-6 leading-6 grow w-0 truncate system-sm-medium text-text-secondary'>{name}</div>)}

          </div>
          {depth < MAX_DEPTH + 1 && (
            <div className='ml-2 shrink-0 system-xs-regular text-text-tertiary'>{getFieldType(payload)}</div>
          )}
        </div>
      </Tooltip>

      {depth <= MAX_DEPTH && payload.type === Type.object && payload.properties && (
        <div>
          {Object.keys(payload.properties).map(name => (
            <Field
              key={name}
              name={name}
              payload={payload.properties?.[name] as FieldType}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  )
}
export default React.memo(Field)
