import { memo } from 'react'
import { capitalize } from 'lodash-es'
import { RiDeleteBinLine, RiEditLine, RiLock2Line } from '@remixicon/react'
import { Env } from '@/app/components/base/icons/src/vender/line/others'
import { useStore } from '@/app/components/workflow/store'
import type {
  EnvironmentVariable,
} from '@/app/components/workflow/types'

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

  return (
    <div className='mb-1 px-2.5 py-2 bg-components-panel-on-panel-item-bg radius-md border-[0.5px] border-components-panel-border-subtle shadow-xs'>
      <div className='flex items-center justify-between'>
        <div className='grow flex gap-1 items-center'>
          <Env className='w-4 h-4 text-util-colors-violet-violet-600' />
          <div className='text-text-primary system-sm-medium'>{env.name}</div>
          <div className='text-text-tertiary system-xs-medium'>{capitalize(env.value_type)}</div>
          {env.value_type === 'secret' && <RiLock2Line className='w-3 h-3 text-text-tertiary' />}
        </div>
        <div className='shrink-0 flex gap-1 items-center text-text-tertiary'>
          <div className='p-1 radius-md cursor-pointer hover:bg-state-base-hover hover:text-text-secondary'>
            <RiEditLine className='w-4 h-4' onClick={() => onEdit(env)}/>
          </div>
          <div className='p-1 radius-md cursor-pointer hover:bg-state-destructive-hover hover:text-text-destructive'>
            <RiDeleteBinLine className='w-4 h-4' onClick={() => onDelete(env)} />
          </div>
        </div>
      </div>
      <div className='text-text-tertiary system-xs-regular truncate'>{env.value_type === 'secret' ? envSecrets[env.id] : env.value}</div>
    </div>
  )
}

export default memo(EnvItem)
