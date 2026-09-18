import type { WorkflowResponse } from '@dify/contracts/api/console/apps/types.gen'
import type { CSSProperties, ReactNode } from 'react'
import type { ModelAndParameter } from '../../configuration/debug/types'
import type { AppPublisherProps } from '../types'
import type { PublishWorkflowParams } from '@/types/workflow'
import { Button } from '@langgenius/dify-ui/button'
import { Kbd, KbdGroup } from '@langgenius/dify-ui/kbd'
import { formatForDisplay } from '@tanstack/react-hotkeys'
import { useTranslation } from 'react-i18next'
import UpgradeBtn from '@/app/components/billing/upgrade-btn'
import { getWorkflowVersionName } from '@/app/components/workflow/utils/version'
import { APP_PUBLISH_HOTKEY } from '../hotkeys'
import PublishWithMultipleModel from '../publish-with-multiple-model'
import { PublisherTimelineMarker } from '../shared/timeline-marker'

type PublisherVersionInfo = Pick<
  WorkflowResponse,
  'created_at' | 'marked_comment' | 'marked_name' | 'version_number'
> & {
  created_by?: { name: string } | null
}

type PublisherSummarySectionProps = Pick<
  AppPublisherProps,
  | 'debugWithMultipleModel'
  | 'draftUpdatedAt'
  | 'multipleModelConfigs'
  | 'publishDisabled'
  | 'publishedAt'
  | 'startNodeLimitExceeded'
> & {
  formatTimeFromNow: (value: number) => string
  handlePublish: (params?: ModelAndParameter | PublishWorkflowParams) => Promise<void>
  handleRestore: () => Promise<void>
  environmentTabs?: ReactNode
  isChatApp: boolean
  isWorkflowApp?: boolean
  onEditVersion?: () => void
  published: boolean
  upgradeHighlightStyle: CSSProperties
  versionInfo?: PublisherVersionInfo | null
}

export function PublisherSummarySection({
  debugWithMultipleModel = false,
  draftUpdatedAt,
  environmentTabs,
  formatTimeFromNow,
  handlePublish,
  handleRestore,
  isChatApp,
  isWorkflowApp = false,
  multipleModelConfigs = [],
  onEditVersion,
  publishDisabled = false,
  published,
  publishedAt,
  startNodeLimitExceeded = false,
  upgradeHighlightStyle,
  versionInfo,
}: PublisherSummarySectionProps) {
  const { t } = useTranslation()
  const hasPublishedVersion = Boolean(publishedAt)
  const publishedTimestamp =
    publishedAt || (versionInfo?.created_at ? versionInfo.created_at * 1000 : undefined)
  const publisherName = versionInfo?.created_by?.name
  const markedName = versionInfo?.marked_name
  const markedComment = versionInfo?.marked_comment
  const publishButtonDisabled = publishDisabled || published
  const publishButtonLabel = published
    ? t(($) => $['common.published'], { ns: 'workflow' })
    : hasPublishedVersion
      ? t(($) => $['common.publishUpdate'], { ns: 'workflow' })
      : t(($) => $['common.publish'], { ns: 'workflow' })

  return (
    <div className="flex flex-col gap-3 p-4">
      {environmentTabs}
      <div className="flex items-start gap-1 px-1 py-0.5">
        <PublisherTimelineMarker position="top" />
        {!hasPublishedVersion ? (
          <p className="min-w-0 flex-1 system-xs-regular text-text-tertiary">
            {t(($) => $['common.notPublishedYet'], { ns: 'workflow' })}
          </p>
        ) : isWorkflowApp ? (
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex min-h-4 min-w-0 items-center gap-1">
              <span className="truncate system-sm-semibold text-text-secondary">
                {getWorkflowVersionName(
                  versionInfo,
                  t(($) => $['versionHistory.defaultName'], { ns: 'workflow' }),
                )}
              </span>
              <span aria-hidden className="system-xs-regular text-text-tertiary">
                ·
              </span>
              {markedName ? (
                <button
                  type="button"
                  className="flex size-4 shrink-0 items-center justify-center rounded text-text-tertiary outline-hidden hover:text-text-accent focus-visible:ring-2 focus-visible:ring-state-accent-solid"
                  aria-label={t(($) => $['versionHistory.editVersionInfo'], { ns: 'workflow' })}
                  disabled={!versionInfo || !onEditVersion}
                  onClick={onEditVersion}
                >
                  <span aria-hidden className="i-ri-edit-line size-3.5" />
                </button>
              ) : (
                <button
                  type="button"
                  className="flex min-w-0 items-center gap-1 rounded text-text-accent outline-hidden hover:text-text-accent-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid disabled:cursor-wait"
                  disabled={!versionInfo || !onEditVersion}
                  onClick={onEditVersion}
                >
                  <span aria-hidden className="i-ri-edit-line size-3.5 shrink-0" />
                  <span className="truncate system-xs-medium">
                    {t(($) => $['versionHistory.nameIt'], { ns: 'workflow' })}
                  </span>
                </button>
              )}
            </div>
            {markedComment && (
              <>
                <p className="line-clamp-3 system-xs-regular wrap-break-word text-text-tertiary">
                  {markedComment}
                </p>
                <span aria-hidden className="my-1 h-px w-4 bg-divider-regular" />
              </>
            )}
            {!!publishedTimestamp && (
              <p className="system-xs-regular text-text-tertiary">
                {publisherName
                  ? t(($) => $['common.publishedBy'], {
                      ns: 'workflow',
                      time: formatTimeFromNow(publishedTimestamp),
                      author: publisherName,
                    })
                  : `${t(($) => $['common.publishedAt'], { ns: 'workflow' })} ${formatTimeFromNow(publishedTimestamp)}`}
              </p>
            )}
          </div>
        ) : (
          <div className="flex min-w-0 flex-1 items-start justify-between gap-2">
            <div className="flex min-w-0 flex-col">
              <p className="truncate system-sm-semibold text-text-secondary">
                {t(($) => $['common.latestPublished'], { ns: 'workflow' })}
              </p>
              {!!publishedTimestamp && (
                <p className="truncate system-xs-regular text-text-tertiary">
                  {publisherName
                    ? t(($) => $['common.publishedBy'], {
                        ns: 'workflow',
                        time: formatTimeFromNow(publishedTimestamp),
                        author: publisherName,
                      })
                    : `${t(($) => $['common.publishedAt'], { ns: 'workflow' })} ${formatTimeFromNow(publishedTimestamp)}`}
                </p>
              )}
            </div>
            {isChatApp && (
              <Button
                variant="secondary"
                size="small"
                className="h-6 shrink-0 gap-1"
                onClick={handleRestore}
                disabled={published}
              >
                <span aria-hidden className="i-ri-reset-left-line size-3.5" />
                {t(($) => $['common.restore'], { ns: 'workflow' })}
              </Button>
            )}
          </div>
        )}
      </div>
      <div className="flex w-full flex-col">
        {debugWithMultipleModel ? (
          <PublishWithMultipleModel
            disabled={publishButtonDisabled}
            multipleModelConfigs={multipleModelConfigs}
            onSelect={(item) => handlePublish(item)}
          />
        ) : (
          <>
            <Button
              variant="primary"
              className="w-full"
              onClick={() => handlePublish()}
              disabled={publishButtonDisabled}
            >
              {publishDisabled ? (
                publishButtonLabel
              ) : (
                <span className="flex items-center gap-1">
                  <span>{publishButtonLabel}</span>
                  <KbdGroup aria-hidden>
                    {APP_PUBLISH_HOTKEY.split('+').map((key) => (
                      <Kbd key={key} color="white" disabled={publishButtonDisabled}>
                        {formatForDisplay(key)}
                      </Kbd>
                    ))}
                  </KbdGroup>
                </span>
              )}
            </Button>
            {startNodeLimitExceeded && (
              <div className="mt-3 flex flex-col items-stretch">
                <p
                  className="text-sm/5 font-semibold text-transparent"
                  style={upgradeHighlightStyle}
                >
                  <span className="block">
                    {t(($) => $['publishLimit.startNodeTitlePrefix'], { ns: 'workflow' })}
                  </span>
                  <span className="block">
                    {t(($) => $['publishLimit.startNodeTitleSuffix'], { ns: 'workflow' })}
                  </span>
                </p>
                <p className="mt-1 text-xs/4 text-text-secondary">
                  {t(($) => $['publishLimit.startNodeDesc'], { ns: 'workflow' })}
                </p>
                <UpgradeBtn isShort className="mt-2.25 mb-3 h-8 w-23.25 self-start" />
              </div>
            )}
          </>
        )}
      </div>
      <div className="flex items-center gap-1 py-0.5 pr-0.5 pl-1">
        <PublisherTimelineMarker position="bottom" />
        <p role="status" className="min-w-0 flex-1 truncate system-xs-regular text-text-tertiary">
          {published ? (
            isWorkflowApp ? (
              t(($) => $['common.published'], { ns: 'workflow' })
            ) : (
              t(($) => $['common.upToDate'], { ns: 'workflow' })
            )
          ) : isWorkflowApp && Boolean(draftUpdatedAt) ? (
            <>
              {t(($) => $['common.autoSaved'], { ns: 'workflow' })}
              {' · '}
              {formatTimeFromNow(draftUpdatedAt!)}
            </>
          ) : (
            t(($) => $['common.currentDraft'], { ns: 'workflow' })
          )}
        </p>
      </div>
    </div>
  )
}
