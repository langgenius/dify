'use client'

import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from 'react-i18next'

export type AgentWorkingDirectoryRootPath = '.' | '../'

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
  path: AgentWorkingDirectoryRootPath
  onPathChange: (path: AgentWorkingDirectoryRootPath) => void
}) {
  const { t } = useTranslation('agentV2')

  return (
    <div className="mb-1 flex w-full shrink-0 flex-col border-y-[0.5px] border-divider-regular px-2.5">
      <nav
        aria-label={t('agentDetail.configure.workingDirectory.breadcrumbLabel')}
        className="flex min-w-0 items-center gap-0.5 py-1"
      >
        <AgentWorkingDirectoryBreadcrumbItem
          active={path === '../'}
          iconClassName="i-ri-folder-3-line"
          label={t('agentDetail.configure.workingDirectory.home')}
          onClick={() => onPathChange('../')}
        />
        {path === '.' && (
          <>
            <span aria-hidden className="system-xs-regular text-divider-deep">/</span>
            <AgentWorkingDirectoryBreadcrumbItem
              active
              iconClassName="i-ri-folder-3-line"
              label={t('agentDetail.configure.workingDirectory.workingDirectory')}
              onClick={() => onPathChange('.')}
            />
          </>
        )}
      </nav>
    </div>
  )
}
