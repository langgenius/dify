import type { EnvironmentVariable } from '@/app/components/workflow/types'
import { cn } from '@langgenius/dify-ui/cn'
import { RiDeleteBinLine, RiEditLine, RiLock2Line } from '@remixicon/react'
import { capitalize } from 'es-toolkit/string'
import { memo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Env } from '@/app/components/base/icons/src/vender/line/others'
import { useStore } from '@/app/components/workflow/store'

type EnvItemProps = {
  env: EnvironmentVariable
  onEdit: (env: EnvironmentVariable) => void
  onDelete: (env: EnvironmentVariable) => void
}

const EnvItem = ({ env, onEdit, onDelete }: EnvItemProps) => {
  const { t } = useTranslation()
  const envSecrets = useStore((s) => s.envSecrets)
  const [destructive, setDestructive] = useState(false)
  const typeLabel =
    env.value_type === 'llm'
      ? t(($) => $['blocks.llm'], { ns: 'workflow' })
      : capitalize(env.value_type)
  const displayValue =
    env.value_type === 'secret'
      ? envSecrets[env.id]
      : typeof env.value === 'object'
        ? env.value.name
        : env.value

  return (
    <div
      className={cn(
        'group mb-1 rounded-lg border border-components-panel-border-subtle bg-components-panel-on-panel-item-bg shadow-xs hover:bg-components-panel-on-panel-item-bg-hover',
        destructive && 'border-state-destructive-border hover:bg-state-destructive-hover',
      )}
    >
      <div className="px-2.5 py-2">
        <div className="flex items-center justify-between">
          <div className="flex grow items-center gap-1">
            <Env className="size-4 text-util-colors-violet-violet-600" />
            <div className="system-sm-medium text-text-primary">{env.name}</div>
            <div className="system-xs-medium text-text-tertiary">{typeLabel}</div>
            {env.value_type === 'secret' && <RiLock2Line className="size-3 text-text-tertiary" />}
          </div>
          <div className="flex shrink-0 items-center gap-1 text-text-tertiary">
            <div className="cursor-pointer rounded-lg p-1 hover:bg-state-base-hover hover:text-text-secondary">
              <RiEditLine className="size-4" onClick={() => onEdit(env)} />
            </div>
            <div
              className="cursor-pointer rounded-lg p-1 hover:bg-state-destructive-hover hover:text-text-destructive"
              onMouseOver={() => setDestructive(true)}
              onMouseOut={() => setDestructive(false)}
            >
              <RiDeleteBinLine className="size-4" onClick={() => onDelete(env)} />
            </div>
          </div>
        </div>
        <div className="truncate system-xs-regular text-text-tertiary">{displayValue}</div>
      </div>
      {env.description && (
        <>
          <div className="h-[0.5px] bg-divider-subtle" />
          <div
            className={cn(
              'rounded-br-[8px] rounded-bl-[8px] bg-background-default-subtle px-2.5 py-2 group-hover:bg-transparent',
              destructive && 'bg-state-destructive-hover hover:bg-state-destructive-hover',
            )}
          >
            <div className="truncate system-xs-regular text-text-tertiary">{env.description}</div>
          </div>
        </>
      )}
    </div>
  )
}

export default memo(EnvItem)
