import { memo, useState } from 'react'
import { capitalize } from 'lodash-es'
import { RiDeleteBinLine, RiEditLine, RiLock2Line } from '@remixicon/react'
import { Env } from '@/app/components/base/icons/src/vender/line/others'
import { useStore } from '@/app/components/workflow/store'
import type { EnvironmentVariable } from '@/app/components/workflow/types'
import cn from '@/utils/classnames'

type EnvItemProps = {
  env: EnvironmentVariable
  onEdit: (env: EnvironmentVariable) => void
  onDelete: (env: EnvironmentVariable) => void
}

const EnvItem = ({
  env,
  onEdit,
  onDelete,
}: EnvItemProps) => {
  const envSecrets = useStore(s => s.envSecrets)
  const [destructive, setDestructive] = useState(false)

  return (
    <div className={cn(
      'bg-components-panel-on-panel-item-bg radius-md border-components-panel-border-subtle shadow-xs hover:bg-components-panel-on-panel-item-bg-hover mb-1 border px-2.5 py-2',
      destructive && 'border-state-destructive-border hover:bg-state-destructive-hover',
    )}>
      <div className='flex items-center justify-between'>
        <div className='flex grow items-center gap-1'>
          <Env className='text-util-colors-violet-violet-600 h-4 w-4' />
          <div className='text-text-primary system-sm-medium'>{env.name}</div>
          <div className='text-text-tertiary system-xs-medium'>{capitalize(env.value_type)}</div>
          {env.value_type === 'secret' && <RiLock2Line className='text-text-tertiary h-3 w-3' />}
        </div>
        <div className='text-text-tertiary flex shrink-0 items-center gap-1'>
          <div className='radius-md hover:bg-state-base-hover hover:text-text-secondary cursor-pointer p-1'>
            <RiEditLine className='h-4 w-4' onClick={() => onEdit(env)}/>
          </div>
          <div
            className='radius-md hover:bg-state-destructive-hover hover:text-text-destructive cursor-pointer p-1'
            onMouseOver={() => setDestructive(true)}
            onMouseOut={() => setDestructive(false)}
          >
            <RiDeleteBinLine className='h-4 w-4' onClick={() => onDelete(env)} />
          </div>
        </div>
      </div>
      <div className='text-text-tertiary system-xs-regular truncate'>{env.value_type === 'secret' ? envSecrets[env.id] : env.value}</div>
    </div>
  )
}

export default memo(EnvItem)
