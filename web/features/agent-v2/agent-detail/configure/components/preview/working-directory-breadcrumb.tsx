'use client'

import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { useTranslation } from 'react-i18next'

export type AgentWorkingDirectoryPath = '.' | '../' | string

type AgentWorkingDirectoryBreadcrumbItemData = {
  iconClassName: string
  label: string
  path: AgentWorkingDirectoryPath
}

const normalizeWorkingDirectoryPath = (path: AgentWorkingDirectoryPath) => {
  if (path === '.' || path === '../')
    return path

  return path.replace(/^\.\/+/, '').replace(/^\/+|\/+$/g, '')
}

function buildPathFromSegments(segments: string[]) {
  return segments.length ? segments.join('/') : '.'
}

function getBreadcrumbItems({
  homeLabel,
  path,
  workingDirectoryLabel,
}: {
  homeLabel: string
  path: AgentWorkingDirectoryPath
  workingDirectoryLabel: string
}): AgentWorkingDirectoryBreadcrumbItemData[] {
  const normalizedPath = normalizeWorkingDirectoryPath(path)
  const homeItem: AgentWorkingDirectoryBreadcrumbItemData = {
    iconClassName: 'i-ri-folder-3-line',
    label: homeLabel,
    path: '../',
  }

  if (normalizedPath === '../')
    return [homeItem]

  const segments = normalizedPath === '.'
    ? []
    : normalizedPath.split('/').filter(Boolean)

  return [
    homeItem,
    {
      iconClassName: 'i-ri-folder-3-line',
      label: workingDirectoryLabel,
      path: '.',
    },
    ...segments.map((segment, index) => ({
      iconClassName: 'i-ri-folder-3-line',
      label: segment,
      path: buildPathFromSegments(segments.slice(0, index + 1)),
    })),
  ]
}

function getVisibleBreadcrumbItems(items: AgentWorkingDirectoryBreadcrumbItemData[]) {
  if (items.length <= 3) {
    return {
      hiddenItems: [],
      visibleItems: items,
    }
  }

  return {
    hiddenItems: items.slice(1, -2),
    visibleItems: [items[0]!, ...items.slice(-2)],
  }
}

function AgentWorkingDirectoryBreadcrumbItem({
  active,
  iconClassName,
  label,
  onClick,
}: {
  active: boolean
  iconClassName: string
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex min-w-0 items-center justify-center gap-1 rounded-md py-0.5 pr-1 pl-0.5 text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden',
        active && 'text-text-secondary',
      )}
    >
      <span aria-hidden className={cn('size-5 shrink-0', iconClassName)} />
      <span className="min-w-0 truncate system-sm-regular">{label}</span>
    </button>
  )
}

export function AgentWorkingDirectoryBreadcrumb({
  path,
  onPathChange,
}: {
  path: AgentWorkingDirectoryPath
  onPathChange: (path: AgentWorkingDirectoryPath) => void
}) {
  const { t } = useTranslation('agentV2')
  const items = getBreadcrumbItems({
    homeLabel: t('agentDetail.configure.workingDirectory.home'),
    path,
    workingDirectoryLabel: t('agentDetail.configure.workingDirectory.workingDirectory'),
  })
  const { hiddenItems, visibleItems } = getVisibleBreadcrumbItems(items)

  const renderSeparator = (key: string) => (
    <span key={key} aria-hidden className="system-xs-regular text-divider-deep">/</span>
  )

  return (
    <div className="mb-1 flex w-full shrink-0 flex-col border-y-[0.5px] border-divider-regular px-2.5">
      <nav
        aria-label={t('agentDetail.configure.workingDirectory.breadcrumbLabel')}
        className="flex min-w-0 items-center gap-0.5 py-1"
      >
        {visibleItems.map((item, index) => {
          const isLastItem = index === visibleItems.length - 1

          return (
            <div key={item.path} className="contents">
              {index > 0 && renderSeparator(`${item.path}-separator`)}
              {index === 1 && hiddenItems.length > 0 && (
                <>
                  <DropdownMenu modal={false}>
                    <DropdownMenuTrigger
                      aria-label="..."
                      className="flex size-6 shrink-0 items-center justify-center rounded-md p-1 text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden data-[popup-open]:bg-state-base-hover data-[popup-open]:text-text-secondary"
                    >
                      <span aria-hidden className="i-ri-more-fill size-4" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent placement="bottom-start" sideOffset={4} popupClassName="w-[136px] p-1">
                      {hiddenItems.map(hiddenItem => (
                        <DropdownMenuItem
                          key={hiddenItem.path}
                          className="gap-1 px-2 py-1.5"
                          onClick={() => onPathChange(hiddenItem.path)}
                        >
                          <span aria-hidden className={cn('size-4 shrink-0 text-text-secondary', hiddenItem.iconClassName)} />
                          <span className="min-w-0 truncate px-1 system-md-regular">{hiddenItem.label}</span>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  {renderSeparator('hidden-items-separator')}
                </>
              )}
              <AgentWorkingDirectoryBreadcrumbItem
                active={isLastItem}
                iconClassName={item.iconClassName}
                label={item.label}
                onClick={() => onPathChange(item.path)}
              />
            </div>
          )
        })}
      </nav>
    </div>
  )
}
