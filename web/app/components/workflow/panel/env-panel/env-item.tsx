import type { EnvironmentVariable } from '@/app/components/workflow/types'
import { RiDeleteBinLine, RiEditLine, RiLock2Line } from '@remixicon/react'
import { capitalize } from 'es-toolkit/string'
import { memo, useState } from 'react'
import { Env } from '@/app/components/base/icons/src/vender/line/others'
import { useStore } from '@/app/components/workflow/store'
import { cn } from '@/utils/classnames'

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
      'group mb-1 border border-components-panel-border-subtle bg-components-panel-on-panel-item-bg shadow-xs radius-md hover:bg-components-panel-on-panel-item-bg-hover',
      destructive && 'border-state-destructive-border hover:bg-state-destructive-hover',
    )}
    >
      <div className="px-2.5 py-2">
        <div className="flex items-center justify-between">
          <div className="flex grow items-center gap-1">
            <Env className="h-4 w-4 text-util-colors-violet-violet-600" />
            <div className="text-text-primary system-sm-medium">{env.name}</div>
            <div className="text-text-tertiary system-xs-medium">{capitalize(env.value_type)}</div>
            {env.value_type === 'secret' && <RiLock2Line className="h-3 w-3 text-text-tertiary" />}
          </div>
          <div className="flex shrink-0 items-center gap-1 text-text-tertiary">
            <div className="cursor-pointer p-1 radius-md hover:bg-state-base-hover hover:text-text-secondary">
              <RiEditLine className="h-4 w-4" onClick={() => onEdit(env)} />
            </div>
            <div
              className="cursor-pointer p-1 radius-md hover:bg-state-destructive-hover hover:text-text-destructive"
              onMouseOver={() => setDestructive(true)}
              onMouseOut={() => setDestructive(false)}
            >
              <RiDeleteBinLine className="h-4 w-4" onClick={() => onDelete(env)} />
            </div>
          </div>
        </div>
        <div className="truncate text-text-tertiary system-xs-regular">{env.value_type === 'secret' ? envSecrets[env.id] : env.value}</div>
      </div>
      {env.description && (
        <>
          <div className="h-[0.5px] bg-divider-subtle" />
          <div className={cn('rounded-bl-[8px] rounded-br-[8px] bg-background-default-subtle px-2.5 py-2 group-hover:bg-transparent', destructive && 'bg-state-destructive-hover hover:bg-state-destructive-hover')}>
            <div className="truncate text-text-tertiary system-xs-regular">{env.description}</div>
          </div>
        </>
      )}
    </div>
  )
}

export default memo(EnvItem)
