'use client'

import type { ReactNode, Ref } from 'react'
import type { AppIconProps } from '@/app/components/base/app-icon'
import { cn } from '@langgenius/dify-ui/cn'
import { useId } from 'react'
import AppIcon from '@/app/components/base/app-icon'
import useTheme from '@/hooks/use-theme'
import { Theme } from '@/types/app'

type Props = Pick<AppIconProps, 'icon'> & {
  ref?: Ref<HTMLLIElement>
  iconDark?: AppIconProps['icon']
  iconClassName?: string
  name: string
  description: string
  warning?: ReactNode
  renderControls: (labels: { labelledBy: string; describedBy: string }) => ReactNode
}

export default function ConnectionServiceItem({
  ref,
  icon,
  iconDark,
  iconClassName,
  name,
  description,
  warning,
  renderControls,
}: Props) {
  const { theme } = useTheme()
  const nameId = useId()
  const descriptionId = useId()
  const warningId = useId()

  return (
    <li
      ref={ref}
      tabIndex={-1}
      aria-labelledby={nameId}
      className="grid grid-cols-[32px_minmax(0,1fr)] items-center gap-3 rounded-2xl border-[0.5px] border-components-panel-border-subtle bg-components-panel-on-panel-item-bg p-3 focus-visible:ring-2 focus-visible:ring-state-accent-solid sm:grid-cols-[32px_minmax(0,1fr)_auto]"
    >
      <AppIcon
        size="small"
        icon={theme === Theme.dark && iconDark ? iconDark : icon}
        fallback={{
          content: (
            <span className={cn('size-6 text-text-secondary', iconClassName ?? 'i-ri-plug-line')} />
          ),
          background: 'var(--color-background-default-dodge)',
        }}
        decorative
      />
      <div className="flex min-w-0 flex-1 flex-col gap-px">
        <span id={nameId} className="system-md-semibold wrap-anywhere text-text-primary">
          {name}
        </span>
        <span id={descriptionId} className="system-xs-regular wrap-anywhere text-text-tertiary">
          {description}
        </span>
        {warning && (
          <span id={warningId} className="system-xs-regular wrap-anywhere text-text-warning">
            {warning}
          </span>
        )}
      </div>
      <div className="col-start-2 flex max-w-full flex-wrap items-center gap-2 sm:col-start-auto">
        {renderControls({
          labelledBy: nameId,
          describedBy: warning ? `${descriptionId} ${warningId}` : descriptionId,
        })}
      </div>
    </li>
  )
}
