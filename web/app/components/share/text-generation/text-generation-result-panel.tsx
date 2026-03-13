import type { FC } from 'react'
import type { InputValueTypes, Task, TextGenerationRunControl } from './types'
import type { PromptConfig } from '@/models/debug'
import type { SiteInfo } from '@/models/share'
import type { AppSourceType } from '@/service/share'
import type { VisionFile, VisionSettings } from '@/types/app'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import Res from '@/app/components/share/text-generation/result'
import { cn } from '@/utils/classnames'
import ResDownload from './run-batch/res-download'
import { TaskStatus } from './types'

type TextGenerationResultPanelProps = {
  allFailedTaskList: Task[]
  allSuccessTaskList: Task[]
  allTaskList: Task[]
  appId: string
  appSourceType: AppSourceType
  completionFiles: VisionFile[]
  controlRetry: number
  controlSend: number
  controlStopResponding: number
  exportRes: Record<string, string>[]
  handleCompleted: (completionRes: string, taskId?: number, isSuccess?: boolean) => void
  handleRetryAllFailedTask: () => void
  handleSaveMessage: (messageId: string) => Promise<void>
  inputs: Record<string, InputValueTypes>
  isCallBatchAPI: boolean
  isPC: boolean
  isShowResultPanel: boolean
  isWorkflow: boolean
  moreLikeThisEnabled: boolean
  noPendingTask: boolean
  onHideResultPanel: () => void
  onRunControlChange: (control: TextGenerationRunControl | null) => void
  onRunStart: () => void
  onShowResultPanel: () => void
  promptConfig: PromptConfig
  resultExisted: boolean
  showTaskList: Task[]
  siteInfo: SiteInfo
  textToSpeechEnabled: boolean
  visionConfig: VisionSettings
}

const TextGenerationResultPanel: FC<TextGenerationResultPanelProps> = ({
  allFailedTaskList,
  allSuccessTaskList,
  allTaskList,
  appId,
  appSourceType,
  completionFiles,
  controlRetry,
  controlSend,
  controlStopResponding,
  exportRes,
  handleCompleted,
  handleRetryAllFailedTask,
  handleSaveMessage,
  inputs,
  isCallBatchAPI,
  isPC,
  isShowResultPanel,
  isWorkflow,
  moreLikeThisEnabled,
  noPendingTask,
  onHideResultPanel,
  onRunControlChange,
  onRunStart,
  onShowResultPanel,
  promptConfig,
  resultExisted,
  showTaskList,
  siteInfo,
  textToSpeechEnabled,
  visionConfig,
}) => {
  const { t } = useTranslation()

  const renderResult = (task?: Task) => (
    <Res
      key={task?.id}
      isWorkflow={isWorkflow}
      isCallBatchAPI={isCallBatchAPI}
      isPC={isPC}
      isMobile={!isPC}
      appSourceType={appSourceType}
      appId={appId}
      isError={task?.status === TaskStatus.failed}
      promptConfig={promptConfig}
      moreLikeThisEnabled={moreLikeThisEnabled}
      inputs={isCallBatchAPI && task ? task.params.inputs : inputs}
      controlSend={controlSend}
      controlRetry={task?.status === TaskStatus.failed ? controlRetry : 0}
      controlStopResponding={controlStopResponding}
      onShowRes={onShowResultPanel}
      handleSaveMessage={handleSaveMessage}
      taskId={task?.id}
      onCompleted={handleCompleted}
      visionConfig={visionConfig}
      completionFiles={completionFiles}
      isShowTextToSpeech={textToSpeechEnabled}
      siteInfo={siteInfo}
      onRunStart={onRunStart}
      onRunControlChange={!isCallBatchAPI ? onRunControlChange : undefined}
      hideInlineStopButton={!isCallBatchAPI}
    />
  )

  return (
    <div
      className={cn(
        isPC
          ? 'h-full w-0 grow'
          : isShowResultPanel
            ? 'fixed inset-0 z-50 bg-background-overlay backdrop-blur-sm'
            : resultExisted
              ? 'relative h-16 shrink-0 overflow-hidden bg-background-default-burn pt-2.5'
              : '',
      )}
    >
      {!isPC && (
        <div
          className={cn(
            isShowResultPanel
              ? 'flex items-center justify-center p-2 pt-6'
              : 'absolute left-0 top-0 z-10 flex w-full items-center justify-center px-2 pb-[57px] pt-[3px]',
          )}
          onClick={() => {
            if (isShowResultPanel)
              onHideResultPanel()
            else
              onShowResultPanel()
          }}
        >
          <div className="h-1 w-8 cursor-grab rounded bg-divider-solid" />
        </div>
      )}
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
          <div
            className={cn(
              'flex shrink-0 items-center justify-between px-14 pb-2 pt-9',
              !isPC && 'px-4 pb-1 pt-3',
            )}
          >
            <div className="text-text-primary system-md-semibold-uppercase">{t('generation.executions', { ns: 'share', num: allTaskList.length })}</div>
            {allSuccessTaskList.length > 0 && (
              <ResDownload
                isMobile={!isPC}
                values={exportRes}
              />
            )}
          </div>
        )}
        <div
          className={cn(
            'flex h-0 grow flex-col overflow-y-auto',
            isPC && 'px-14 py-8',
            isPC && isCallBatchAPI && 'pt-0',
            !isPC && 'p-0 pb-2',
          )}
        >
          {isCallBatchAPI ? showTaskList.map(task => renderResult(task)) : renderResult()}
          {!noPendingTask && (
            <div className="mt-4">
              <Loading type="area" />
            </div>
          )}
        </div>
        {isCallBatchAPI && allFailedTaskList.length > 0 && (
          <div className="absolute bottom-6 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-xl border border-components-panel-border bg-components-panel-bg-blur p-3 shadow-lg backdrop-blur-sm">
            <span aria-hidden className="i-ri-error-warning-fill h-4 w-4 text-text-destructive" />
            <div className="text-text-secondary system-sm-medium">{t('generation.batchFailed.info', { ns: 'share', num: allFailedTaskList.length })}</div>
            <div className="h-3.5 w-px bg-divider-regular"></div>
            <div onClick={handleRetryAllFailedTask} className="cursor-pointer text-text-accent system-sm-semibold-uppercase">{t('generation.batchFailed.retry', { ns: 'share' })}</div>
          </div>
        )}
      </div>
    </div>
  )
}

export default TextGenerationResultPanel
