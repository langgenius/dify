'use client'
import type { FC } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { RiCloseLine, RiPlayLargeLine } from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import { WorkflowContextProvider } from '@/app/components/workflow/context'
import Run from '@/app/components/workflow/run'
import { useRouter } from '@/next/navigation'

type ILogDetail = {
  appId: string
  runID: string
  onClose: () => void
  canReplay?: boolean
}

const DetailPanel: FC<ILogDetail> = ({ appId, runID, onClose, canReplay = false }) => {
  const { t } = useTranslation(['appLog', 'common'])
  const router = useRouter()

  const handleReplay = () => {
    router.push(`/app/${appId}/workflow?replayRunId=${runID}`)
  }

  return (
    <div className="relative flex grow flex-col pt-3">
      <button
        type="button"
        aria-label={t(($) => $['operation.close'], { ns: 'common' })}
        className="absolute top-4 right-3 z-20 cursor-pointer border-none bg-transparent p-1 focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden"
        onClick={onClose}
      >
        <RiCloseLine className="size-4 text-text-tertiary" aria-hidden="true" />
      </button>
      <div className="flex items-center bg-components-panel-bg">
        <h1 className="shrink-0 px-4 py-1 system-xl-semibold text-text-primary">
          {t(($) => $['runDetail.workflowTitle'], { ns: 'appLog' })}
        </h1>
        {canReplay && (
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  className="mr-1 flex size-6 items-center justify-center rounded-md border-none bg-transparent p-0 hover:bg-state-base-hover"
                  aria-label={t(($) => $['runDetail.testWithParams'], { ns: 'appLog' })}
                  onClick={handleReplay}
                >
                  <RiPlayLargeLine className="size-4 text-text-tertiary" aria-hidden="true" />
                </button>
              }
            />
            <TooltipContent>
              {t(($) => $['runDetail.testWithParams'], { ns: 'appLog' })}
            </TooltipContent>
          </Tooltip>
        )}
      </div>
      <WorkflowContextProvider>
        <Run
          runDetailUrl={runID ? `/apps/${appId}/workflow-runs/${runID}` : ''}
          tracingListUrl={runID ? `/apps/${appId}/workflow-runs/${runID}/node-executions` : ''}
        />
      </WorkflowContextProvider>
    </div>
  )
}

export default DetailPanel
