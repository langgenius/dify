import { memo, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useFormatTimeFromNow } from '@/hooks/use-format-time-from-now'
import { useStore } from '../store'
import { WorkflowVersion } from '../types'
import useTimestamp from '@/hooks/use-timestamp'

const RestoringTitle = () => {
  const { t } = useTranslation()
  const { formatTimeFromNow } = useFormatTimeFromNow()
  const { formatTime } = useTimestamp()
  const currentVersion = useStore(state => state.currentVersion)
  const isDraft = currentVersion?.version === WorkflowVersion.Draft
  const publishStatus = isDraft ? t('workflow.common.unpublished') : t('workflow.common.published')

  const versionName = useMemo(() => {
    if (isDraft)
      return t('workflow.versionHistory.currentDraft')
    return currentVersion?.marked_name || t('workflow.versionHistory.defaultName')
  }, [currentVersion, t, isDraft])

  return (
    <div className='flex flex-col gap-y-0.5'>
      <div className='flex items-center gap-x-1'>
        <span className='system-sm-semibold text-text-primary'>
          {versionName}
        </span>
        <span className='system-2xs-medium-uppercase rounded-[5px] border border-text-accent-secondary bg-components-badge-bg-dimm px-1 py-0.5 text-text-accent-secondary'>
          {t('workflow.common.viewOnly')}
        </span>
      </div>
      <div className='system-xs-regular flex h-4 items-center gap-x-1 text-text-tertiary'>
        {
          currentVersion && (
            <>
              <span>{publishStatus}</span>
              <span>·</span>
              <span>{`${formatTimeFromNow((isDraft ? currentVersion.updated_at : currentVersion.created_at) * 1000)} ${formatTime(currentVersion.created_at, 'HH:mm:ss')}`}</span>
              <span>·</span>
              <span>{currentVersion?.created_by?.name || ''}</span>
            </>
          )
        }
      </div>
    </div>
  )
}

export default memo(RestoringTitle)
