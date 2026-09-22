import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Fragment } from 'react'
import { useTranslation } from 'react-i18next'

export type Operation = {
  id: string
  title: string
  icon: string
  onClick: () => void
  disabled?: boolean
  loading?: boolean
  variant?: 'default' | 'destructive'
}

type AppOperationsProps = {
  appName: string
  operationGroups: Operation[][]
}

const AppOperations = ({ appName, operationGroups }: AppOperationsProps) => {
  const { t } = useTranslation()
  const visibleGroups = operationGroups.filter((group) => group.length > 0)

  if (!visibleGroups.length) return null

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        render={
          <IconButton
            aria-label={t(($) => $['operation.moreActionsFor'], {
              ns: 'common',
              name: appName,
            })}
            size="md"
            className="-mx-1 -my-0.5 data-popup-open:bg-state-base-hover data-popup-open:text-text-secondary"
          >
            <span aria-hidden className="i-ri-more-fill size-4" />
          </IconButton>
        }
      />
      <DropdownMenuContent placement="bottom-end" sideOffset={4} className="min-w-40">
        {visibleGroups.map((group, groupIndex) => (
          <Fragment key={group.map((operation) => operation.id).join('-')}>
            {groupIndex > 0 && <DropdownMenuSeparator />}
            <DropdownMenuGroup>
              {group.map((operation) => (
                <DropdownMenuItem
                  key={operation.id}
                  variant={operation.variant}
                  className="gap-2 px-3"
                  disabled={operation.disabled || operation.loading}
                  onClick={operation.onClick}
                >
                  {operation.loading ? (
                    <span
                      aria-hidden
                      className="i-ri-loader-2-line size-4 animate-spin text-text-tertiary motion-reduce:animate-none"
                    />
                  ) : (
                    <span
                      aria-hidden
                      className={cn(
                        operation.icon,
                        'size-4',
                        operation.variant === 'destructive'
                          ? 'text-text-destructive'
                          : 'text-text-tertiary',
                      )}
                    />
                  )}
                  <span
                    className={cn(
                      'system-sm-regular',
                      operation.variant !== 'destructive' && 'text-text-secondary',
                    )}
                  >
                    {operation.title}
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export default AppOperations
