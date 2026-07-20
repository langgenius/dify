import type { AgentConfigSnapshotSummaryResponse } from '@dify/contracts/api/console/agent/types.gen'
import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from 'react-i18next'
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
}: {
  version: AgentConfigSnapshotSummaryResponse
  activeVersionId?: string | null
  isLatest: boolean
  isFirst: boolean
  isLast: boolean
  onSelect: (versionId: string) => void
}) {
  const { t } = useTranslation('agentV2')
  const { t: tWorkflow } = useTranslation('workflow')
  const isActive = version.id === activeVersionId
  const label =
    version.version_note ||
    t(($) => $['agentDetail.versionHistory.versionName'], { version: version.version })

  return (
    <button
      type="button"
      aria-current={isActive ? 'true' : undefined}
      onClick={() => onSelect(version.id)}
      className={cn(
        'group relative flex w-full items-start gap-1 rounded-lg py-1 pr-1.5 pl-2 text-left focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden',
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
            <span className="shrink-0 rounded-[5px] border border-text-accent-secondary bg-components-badge-bg-dimm px-[5px] py-[3px] system-2xs-medium-uppercase text-text-accent-secondary">
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
  )
}
