'use client'
import type { FC } from 'react'
import { RiCheckLine, RiCloseLine } from '@remixicon/react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import Textarea from '@/app/components/base/textarea'
import Toast from '@/app/components/base/toast'
import { ResumeAction, resumeWorkflowRun } from '@/service/workflow'

type HumanInputResumePanelProps = {
  appId: string
  workflowRunId: string
  pauseReason?: string
  onResumed?: () => void
}

const HumanInputResumePanel: FC<HumanInputResumePanelProps> = ({
  appId,
  workflowRunId,
  pauseReason,
  onResumed,
}) => {
  const { t } = useTranslation()
  const [resumeReason, setResumeReason] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleResume = useCallback(async (action: ResumeAction) => {
    const trimmedReason = resumeReason.trim()
    if (!trimmedReason) {
      Toast.notify({
        type: 'error',
        message: t('workflow.nodes.humanInput.resumeReasonRequired'),
      })
      return
    }

    setIsSubmitting(true)
    try {
      await resumeWorkflowRun(appId, workflowRunId, {
        reason: trimmedReason,
        action,
      })
      // 使用 info 级别提示，因为后端 Celery 任务可能执行失败
      Toast.notify({
        type: 'info',
        message: t('workflow.nodes.humanInput.action.resumeRequested'),
      })
      onResumed?.()
    }
    catch (error: unknown) {
      const message = error instanceof Error
        ? error.message
        : 'Failed to resume workflow'
      Toast.notify({
        type: 'error',
        message,
      })
    }
    finally {
      setIsSubmitting(false)
    }
  }, [appId, workflowRunId, resumeReason, t, onResumed])

  return (
    <div className="rounded-lg border border-components-panel-border bg-components-panel-bg p-4">
      <div className="mb-3">
        <div className="system-sm-semibold mb-1 text-text-primary">
          {t('workflow.nodes.humanInput.status.paused')}
        </div>
        {pauseReason && (
          <div className="system-xs-regular text-text-tertiary">
            {pauseReason}
          </div>
        )}
      </div>

      <div className="mb-3">
        <div className="system-xs-medium mb-1 text-text-secondary">
          {t('workflow.nodes.humanInput.resumeReason')}
        </div>
        <Textarea
          className="min-h-[80px] w-full resize-none"
          placeholder={t('workflow.nodes.humanInput.resumeReasonPlaceholder') || ''}
          value={resumeReason}
          onChange={e => setResumeReason(e.target.value)}
          disabled={isSubmitting}
        />
      </div>

      <div className="flex gap-2">
        <Button
          variant="primary"
          className="flex-1"
          onClick={() => handleResume(ResumeAction.APPROVE)}
          disabled={isSubmitting || !resumeReason.trim()}
        >
          <RiCheckLine className="mr-1 h-4 w-4" />
          {t('workflow.nodes.humanInput.approve')}
        </Button>
        <Button
          variant="secondary-accent"
          className="flex-1"
          onClick={() => handleResume(ResumeAction.REJECT)}
          disabled={isSubmitting || !resumeReason.trim()}
        >
          <RiCloseLine className="mr-1 h-4 w-4" />
          {t('workflow.nodes.humanInput.reject')}
        </Button>
      </div>
    </div>
  )
}

export default HumanInputResumePanel
