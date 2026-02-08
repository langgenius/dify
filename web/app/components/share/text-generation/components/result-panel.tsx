import type { FC, ReactNode } from 'react'
import { RiErrorWarningFill } from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import { cn } from '@/utils/classnames'
import ResDownload from '../run-batch/res-download'

type ResultPanelProps = {
  isPC: boolean
  isShowResultPanel: boolean
  isCallBatchAPI: boolean
  totalTasks: number
  successCount: number
  failedCount: number
  noPendingTask: boolean
  exportRes: Record<string, string>[]
  onRetryFailed: () => void
  children: ReactNode
}

const ResultPanel: FC<ResultPanelProps> = ({
  isPC,
  isShowResultPanel,
  isCallBatchAPI,
  totalTasks,
  successCount,
  failedCount,
  noPendingTask,
  exportRes,
  onRetryFailed,
  children,
}) => {
  const { t } = useTranslation()

  return (
    <div
      className={cn(
        'relative flex h-full flex-col',
        !isPC && 'h-[calc(100vh_-_36px)] rounded-t-2xl shadow-lg backdrop-blur-sm',
        !isPC
          ? isShowResultPanel
            ? 'bg-background-default-burn'
            : 'border-t-[0.5px] border-divider-regular bg-components-panel-bg'
          : 'bg-chatbot-bg',
      )}
    >
      {isCallBatchAPI && (
        <div className={cn(
          'flex shrink-0 items-center justify-between px-14 pb-2 pt-9',
          !isPC && 'px-4 pb-1 pt-3',
        )}
        >
          <div className="system-md-semibold-uppercase text-text-primary">
            {t('generation.executions', { ns: 'share', num: totalTasks })}
          </div>
          {successCount > 0 && (
            <ResDownload isMobile={!isPC} values={exportRes} />
          )}
        </div>
      )}
      <div className={cn(
        'flex h-0 grow flex-col overflow-y-auto',
        isPC && 'px-14 py-8',
        isPC && isCallBatchAPI && 'pt-0',
        !isPC && 'p-0 pb-2',
      )}
      >
        {children}
        {!noPendingTask && (
          <div className="mt-4">
            <Loading type="area" />
          </div>
        )}
      </div>
      {isCallBatchAPI && failedCount > 0 && (
        <div className="absolute bottom-6 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-xl border border-components-panel-border bg-components-panel-bg-blur p-3 shadow-lg backdrop-blur-sm">
          <RiErrorWarningFill className="h-4 w-4 text-text-destructive" />
          <div className="system-sm-medium text-text-secondary">
            {t('generation.batchFailed.info', { ns: 'share', num: failedCount })}
          </div>
          <div className="h-3.5 w-px bg-divider-regular"></div>
          <div
            onClick={onRetryFailed}
            className="system-sm-semibold-uppercase cursor-pointer text-text-accent"
          >
            {t('generation.batchFailed.retry', { ns: 'share' })}
          </div>
        </div>
      )}
    </div>
  )
}

export default ResultPanel
