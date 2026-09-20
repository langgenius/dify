import type { AgentConfigSnapshotSummaryResponse } from '@dify/contracts/api/console/agent/types.gen'
import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { useTranslation } from 'react-i18next'
import PremiumBadge from '@/app/components/base/premium-badge'
import useTimestamp from '@/hooks/use-timestamp'
import { VersionTimelineDot } from './version-timeline-dot'

function VersionMetadata({ version }: { version: AgentConfigSnapshotSummaryResponse }) {
  const { t } = useTranslation('agentV2')
  const { formatTime } = useTimestamp()

  if (version.created_at == null && !version.created_by) return null

  return (
    <p className="truncate system-xs-regular text-text-tertiary">
      {version.created_at != null &&
        formatTime(
          version.created_at,
          t(($) => $['roster.dateTimeFormat']),
        )}
      {version.created_at != null && version.created_by && ' · '}
      {version.created_by}
    </p>
  )
}

export function VersionItem({
  version,
  activeVersionId,
  isLatest,
  isFirst,
  isLast,
  onSelect,
  onExport,
  onRestore,
  restoreDisabled,
  exportDisabled,
  showUpgrade,
}: {
  version: AgentConfigSnapshotSummaryResponse
  activeVersionId?: string | null
  isLatest: boolean
  isFirst: boolean
  isLast: boolean
  onSelect: (versionId: string) => void
  onExport?: (versionId: string) => void
  onRestore?: (version: AgentConfigSnapshotSummaryResponse) => void
  restoreDisabled?: boolean
  exportDisabled?: boolean
  showUpgrade?: boolean
}) {
  const { t } = useTranslation('agentV2')
  const { t: tWorkflow } = useTranslation('workflow')
  const isActive = version.id === activeVersionId
  const label =
    version.version_note ||
    t(($) => $['agentDetail.versionHistory.versionName'], { version: version.version })

  return (
    <div className="group relative">
      <button
        type="button"
        aria-current={isActive ? 'true' : undefined}
        onClick={() => onSelect(version.id)}
        className={cn(
          'group relative flex w-full items-start gap-1 rounded-lg py-1 pl-2 text-left focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden',
          onExport || onRestore ? 'pr-8' : 'pr-1.5',
          isActive ? 'bg-state-accent-active' : 'hover:bg-state-base-hover',
        )}
      >
        <VersionTimelineDot isActive={isActive} isFirst={isFirst} isLast={isLast} />
        <div className="min-w-0 flex-1 py-0.5">
          <div className="flex min-w-0 items-center gap-1">
            <p
              className={cn(
                'truncate system-sm-semibold',
                isActive ? 'text-text-accent' : 'text-text-secondary',
              )}
            >
              {label}
            </p>
            {isLatest && (
              <span className="shrink-0 rounded-[5px] border border-text-accent-secondary bg-components-badge-bg-dimm px-1.25 py-0.75 system-2xs-medium-uppercase text-text-accent-secondary">
                {tWorkflow(($) => $['versionHistory.latest'])}
              </span>
            )}
          </div>
          {isActive && version.summary && (
            <p className="mt-0.5 line-clamp-4 system-xs-regular text-text-secondary">
              {version.summary}
            </p>
          )}
          <VersionMetadata version={version} />
        </div>
      </button>
      {(onExport || onRestore) && (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <IconButton
                aria-label={t(($) => $['roster.moreActions'], { name: label })}
                size="sm"
                className="absolute top-1 right-1 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 data-popup-open:bg-state-base-hover data-popup-open:text-text-secondary data-popup-open:opacity-100 [@media(hover:none)]:opacity-100"
              >
                <span aria-hidden className="i-ri-more-fill size-4" />
              </IconButton>
            }
          />
          <DropdownMenuContent placement="bottom-end" className="min-w-40">
            {onRestore && (
              <DropdownMenuItem
                disabled={restoreDisabled}
                onClick={() => onRestore(version)}
                className="gap-2"
              >
                <span aria-hidden className="i-ri-history-line size-4 shrink-0" />
                <span className="flex-1">{tWorkflow(($) => $['common.restore'])}</span>
                {showUpgrade && (
                  <PremiumBadge size="s">
                    {t(($) => $['upgradeBtn.encourageShort'], { ns: 'billing' })}
                  </PremiumBadge>
                )}
              </DropdownMenuItem>
            )}
            {onExport && (
              <DropdownMenuItem
                disabled={exportDisabled}
                onClick={() => onExport(version.id)}
                className="gap-2"
              >
                <span aria-hidden className="i-ri-file-download-line size-4 shrink-0" />
                <span className="flex-1">{t(($) => $.exportApp, { ns: 'app' })}</span>
                {showUpgrade && (
                  <PremiumBadge size="s">
                    {t(($) => $['upgradeBtn.encourageShort'], { ns: 'billing' })}
                  </PremiumBadge>
                )}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}
