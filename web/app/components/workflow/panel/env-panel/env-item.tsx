import type { EnvironmentVariable } from '@/app/components/workflow/types'
import { cn } from '@langgenius/dify-ui/cn'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { RiDeleteBinLine, RiEditLine, RiLock2Line } from '@remixicon/react'
import { capitalize } from 'es-toolkit/string'
import { memo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore } from '@/app/components/workflow/store'

type EnvItemProps = {
  env: EnvironmentVariable
  onEdit: (env: EnvironmentVariable) => void
  onDelete: (env: EnvironmentVariable) => void
}

const EnvItem = ({ env, onEdit, onDelete }: EnvItemProps) => {
  const { t } = useTranslation(['workflow', 'common'])
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
            <span
              aria-hidden
              className="i-custom-vender-line-others-env size-4 text-util-colors-violet-violet-600"
            />
            <div className="system-sm-medium text-text-primary">{env.name}</div>
            <div className="system-xs-medium text-text-tertiary">{typeLabel}</div>
            {env.value_type === 'secret' && <RiLock2Line className="size-3 text-text-tertiary" />}
          </div>
          <div className="flex shrink-0 items-center gap-1 text-text-tertiary">
            <IconButton
              aria-label={`${t(($) => $['operation.edit'], { ns: 'common' })} ${env.name}`}
              onClick={() => onEdit(env)}
            >
              <RiEditLine aria-hidden className="size-4" />
            </IconButton>
            <IconButton
              tone="destructive"
              aria-label={`${t(($) => $['operation.delete'], { ns: 'common' })} ${env.name}`}
              onMouseEnter={() => setDestructive(true)}
              onMouseLeave={() => setDestructive(false)}
              onFocus={() => setDestructive(true)}
              onBlur={() => setDestructive(false)}
              onClick={() => onDelete(env)}
            >
              <RiDeleteBinLine aria-hidden className="size-4" />
            </IconButton>
          </div>
        </div>
        <div className="truncate system-xs-regular text-text-tertiary">{displayValue}</div>
      </div>
      {env.description && (
        <>
          <div className="h-[0.5px] bg-divider-subtle" />
          <div
            className={cn(
              'rounded-br-lg rounded-bl-lg bg-background-default-subtle px-2.5 py-2 group-hover:bg-transparent',
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
