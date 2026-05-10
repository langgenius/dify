'use client'
import type { FC } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { RiCloseLine, RiPlayLargeLine } from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import { useStore } from '@/app/components/app/store'
import { WorkflowContextProvider } from '@/app/components/workflow/context'
import Run from '@/app/components/workflow/run'
import { useRouter } from '@/next/navigation'

type ILogDetail = {
  runID: string
  onClose: () => void
  canReplay?: boolean
}

const DetailPanel: FC<ILogDetail> = ({ runID, onClose, canReplay = false }) => {
  const { t } = useTranslation()
  const appDetail = useStore(state => state.appDetail)
  const router = useRouter()

  const handleReplay = () => {
    if (!appDetail?.id)
      return
    router.push(`/app/${appDetail.id}/workflow?replayRunId=${runID}`)
  }

  return (
    <div className="relative flex grow flex-col pt-3">
      <span className="absolute top-4 right-3 z-20 cursor-pointer p-1" onClick={onClose}>
        <RiCloseLine className="h-4 w-4 text-text-tertiary" />
      </span>
      <div className="flex items-center bg-components-panel-bg">
        <h1 className="shrink-0 px-4 py-1 system-xl-semibold text-text-primary">{t('runDetail.workflowTitle', { ns: 'appLog' })}</h1>
        {canReplay && (
          <Tooltip>
            <TooltipTrigger
              render={(
                <button
                  type="button"
                  className="mr-1 flex h-6 w-6 items-center justify-center rounded-md hover:bg-state-base-hover"
                  aria-label={t('runDetail.testWithParams', { ns: 'appLog' })}
                  onClick={handleReplay}
                >
                  <RiPlayLargeLine className="h-4 w-4 text-text-tertiary" />
                </button>
              )}
            />
            <TooltipContent className="rounded-xl">
              {t('runDetail.testWithParams', { ns: 'appLog' })}
            </TooltipContent>
          </Tooltip>
        )}
      </div>
      <WorkflowContextProvider>
        <Run
          runDetailUrl={runID ? `/apps/${appDetail?.id}/workflow-runs/${runID}` : ''}
          tracingListUrl={runID ? `/apps/${appDetail?.id}/workflow-runs/${runID}/node-executions` : ''}
        />
      </WorkflowContextProvider>
    </div>
  )
}

export default DetailPanel
