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
      'radius-md mb-1 border border-components-panel-border-subtle bg-components-panel-on-panel-item-bg px-2.5 py-2 shadow-xs hover:bg-components-panel-on-panel-item-bg-hover',
      destructive && 'border-state-destructive-border hover:bg-state-destructive-hover',
    )}>
      <div className='flex items-center justify-between'>
        <div className='flex grow items-center gap-1'>
          <Env className='h-4 w-4 text-util-colors-violet-violet-600' />
          <div className='system-sm-medium text-text-primary'>{env.name}</div>
          <div className='system-xs-medium text-text-tertiary'>{capitalize(env.value_type)}</div>
          {env.value_type === 'secret' && <RiLock2Line className='h-3 w-3 text-text-tertiary' />}
        </div>
        <div className='flex shrink-0 items-center gap-1 text-text-tertiary'>
          <div className='radius-md cursor-pointer p-1 hover:bg-state-base-hover hover:text-text-secondary'>
            <RiEditLine className='h-4 w-4' onClick={() => onEdit(env)}/>
          </div>
          <div
            className='radius-md cursor-pointer p-1 hover:bg-state-destructive-hover hover:text-text-destructive'
            onMouseOver={() => setDestructive(true)}
            onMouseOut={() => setDestructive(false)}
          >
            <RiDeleteBinLine className='h-4 w-4' onClick={() => onDelete(env)} />
          </div>
        </div>
      </div>
      <div className='system-xs-regular truncate text-text-tertiary'>{env.value_type === 'secret' ? envSecrets[env.id] : env.value}</div>
    </div>
  )
}

export default memo(EnvItem)
