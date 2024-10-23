import { memo } from 'react'
import { capitalize } from 'lodash-es'
import { Env } from '@/app/components/base/icons/src/vender/line/others'
import type { GlobalVariable } from '@/app/components/workflow/types'
import cn from '@/utils/classnames'

type Props = {
  payload: GlobalVariable
}

const Item = ({
  payload,
}: Props) => {
  return (
    <div className={cn(
      'mb-1 px-2.5 py-2 bg-components-panel-on-panel-item-bg radius-md border border-components-panel-border-subtle shadow-xs hover:bg-components-panel-on-panel-item-bg-hover',
    )}>
      <div className='flex items-center justify-between'>
        <div className='grow flex gap-1 items-center'>
          <Env className='w-4 h-4 text-util-colors-violet-violet-600' />
          <div className='text-text-primary system-sm-medium'>{payload.name}</div>
          <div className='text-text-tertiary system-xs-medium'>{capitalize(payload.value_type)}</div>
        </div>
      </div>
      <div className='text-text-tertiary system-xs-regular truncate'>{payload.description}</div>
    </div>
  )
}

export default memo(Item)
