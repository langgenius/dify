import type { ComponentProps } from 'react'
import type { Operation } from './app-operations'
import { cn } from '@langgenius/dify-ui/cn'
import AppIcon from '../../base/app-icon'
import AppOperations from './app-operations'

type AppInfoHeaderProps = Pick<
  ComponentProps<typeof AppIcon>,
  'iconType' | 'icon' | 'background' | 'imageUrl'
> & {
  expand: boolean
  appName: string
  modeLabel?: string
  operationGroups: Operation[][]
}

export default function AppInfoHeader({
  expand,
  appName,
  modeLabel,
  iconType,
  icon,
  background,
  imageUrl,
  operationGroups,
}: AppInfoHeaderProps) {
  return (
    <div
      className={cn(
        'rounded-xl',
        expand ? 'flex items-start gap-2 p-2' : 'flex items-center justify-center px-1 py-1.5',
      )}
    >
      <div className="flex shrink-0 items-center">
        <AppIcon
          size="medium"
          rounded
          decorative
          iconType={iconType}
          icon={icon}
          background={background}
          imageUrl={imageUrl}
        />
      </div>
      {expand && (
        <div className="flex min-w-0 flex-1 flex-col items-start justify-center gap-0.5 self-stretch">
          <div className="flex w-full min-w-0 items-center gap-2 pr-1">
            <div
              className="min-w-0 flex-1 truncate system-md-semibold text-text-secondary"
              title={appName}
            >
              {appName}
            </div>
            <AppOperations appName={appName} operationGroups={operationGroups} />
          </div>
          <div className="min-h-3 system-2xs-medium-uppercase whitespace-nowrap text-text-tertiary">
            {modeLabel}
          </div>
        </div>
      )}
    </div>
  )
}
