'use client'
import type { FC } from 'react'
import type { WorkflowProcess } from '@/app/components/base/chat/types'
import type { SiteInfo } from '@/models/share'
import { cn } from '@langgenius/dify-ui/cn'
import { RiPlayList2Line } from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import HumanInputFilledFormList from '@/app/components/base/chat/chat/answer/human-input-filled-form-list'
import HumanInputFormList from '@/app/components/base/chat/chat/answer/human-input-form-list'
import WorkflowProcessItem from '@/app/components/base/chat/chat/answer/workflow-process'
import ResultTab from './result-tab'
import { getGenerationTaskLabel } from './utils'

type WorkflowBodyProps = {
  content: unknown
  currentTab: string
  depth: number
  hideProcessDetail?: boolean
  isError: boolean
  onSubmitHumanInputForm: (formToken: string, formData: { inputs: Record<string, string>, action: string }) => Promise<void>
  onSwitchTab: (tab: string) => void
  showResultTabs: boolean
  siteInfo: SiteInfo | null
  taskId?: string
  workflowProcessData?: WorkflowProcess
}

const WorkflowBody: FC<WorkflowBodyProps> = ({
  content,
  currentTab,
  depth,
  hideProcessDetail,
  isError,
  onSubmitHumanInputForm,
  onSwitchTab,
  showResultTabs,
  siteInfo,
  taskId,
  workflowProcessData,
}) => {
  const { t } = useTranslation()

  if (!workflowProcessData)
    return null

  return (
    <>
      <div
        className={cn(
          'p-3',
          showResultTabs && 'border-b border-divider-subtle',
        )}
      >
        {taskId && (
          <div className={cn('mb-2 flex items-center system-2xs-medium-uppercase text-text-accent-secondary', isError && 'text-text-destructive')}>
            <RiPlayList2Line className="mr-1 h-3 w-3" />
            <span>{t('generation.execution', { ns: 'share' })}</span>
            <span className="px-1">·</span>
            <span>{getGenerationTaskLabel(taskId, depth)}</span>
          </div>
        )}
        {siteInfo && (
          <WorkflowProcessItem
            data={workflowProcessData}
            expand={workflowProcessData.expand}
            hideProcessDetail={hideProcessDetail}
            hideInfo={hideProcessDetail}
            readonly={!siteInfo.show_workflow_steps}
          />
        )}
        {showResultTabs && (
          <div className="flex items-center space-x-6 px-1">
            <div
              className={cn(
                'cursor-pointer border-b-2 border-transparent py-3 system-sm-semibold-uppercase text-text-tertiary',
                currentTab === 'RESULT' && 'border-util-colors-blue-brand-blue-brand-600 text-text-primary',
              )}
              onClick={() => onSwitchTab('RESULT')}
            >
              {t('result', { ns: 'runLog' })}
            </div>
            <div
              className={cn(
                'cursor-pointer border-b-2 border-transparent py-3 system-sm-semibold-uppercase text-text-tertiary',
                currentTab === 'DETAIL' && 'border-util-colors-blue-brand-blue-brand-600 text-text-primary',
              )}
              onClick={() => onSwitchTab('DETAIL')}
            >
              {t('detail', { ns: 'runLog' })}
            </div>
          </div>
        )}
      </div>
      {!isError && (
        <>
          {currentTab === 'RESULT' && workflowProcessData.humanInputFormDataList && workflowProcessData.humanInputFormDataList.length > 0 && (
            <div className="px-4 pt-4">
              <HumanInputFormList
                humanInputFormDataList={workflowProcessData.humanInputFormDataList}
                onHumanInputFormSubmit={onSubmitHumanInputForm}
              />
            </div>
          )}
          {currentTab === 'RESULT' && workflowProcessData.humanInputFilledFormDataList && workflowProcessData.humanInputFilledFormDataList.length > 0 && (
            <div className="px-4 pt-4">
              <HumanInputFilledFormList
                humanInputFilledFormDataList={workflowProcessData.humanInputFilledFormDataList}
              />
            </div>
          )}
          <ResultTab data={workflowProcessData} content={content} currentTab={currentTab} />
        </>
      )}
    </>
  )
}

export default WorkflowBody
