import {
  memo,
} from 'react'

import { RiCloseLine } from '@remixicon/react'
import type { GlobalVariable } from '../../types'
import Item from './item'
import { useStore } from '@/app/components/workflow/store'

import { cn } from '@/utils/classnames'
import { useTranslation } from 'react-i18next'
import { useIsChatMode } from '../../hooks'
import { isInWorkflowPage } from '../../constants'

const Panel = () => {
  const { t } = useTranslation()
  const isChatMode = useIsChatMode()
  const setShowPanel = useStore(s => s.setShowGlobalVariablePanel)
  const isWorkflowPage = isInWorkflowPage()

  const globalVariableList: GlobalVariable[] = [
    ...(isChatMode ? [{
      name: 'conversation_id',
      value_type: 'string' as const,
      description: t('workflow.globalVar.fieldsDescription.conversationId'),
    },
    {
      name: 'dialog_count',
      value_type: 'number' as const,
      description: t('workflow.globalVar.fieldsDescription.dialogCount'),
    }] : []),
    {
      name: 'user_id',
      value_type: 'string',
      description: t('workflow.globalVar.fieldsDescription.userId'),
    },
    {
      name: 'app_id',
      value_type: 'string',
      description: t('workflow.globalVar.fieldsDescription.appId'),
    },
    {
      name: 'workflow_id',
      value_type: 'string',
      description: t('workflow.globalVar.fieldsDescription.workflowId'),
    },
    {
      name: 'workflow_run_id',
      value_type: 'string',
      description: t('workflow.globalVar.fieldsDescription.workflowRunId'),
    },
    // is workflow
    ...((isWorkflowPage && !isChatMode) ? [{
      name: 'timestamp',
      value_type: 'number' as const,
      description: t('workflow.globalVar.fieldsDescription.triggerTimestamp'),
    }] : []),
  ]

  return (
    <div
      className={cn(
        'relative flex h-full w-[420px] flex-col rounded-l-2xl border border-components-panel-border bg-components-panel-bg-alt',
      )}
    >
      <div className='system-xl-semibold flex shrink-0 items-center justify-between p-4 pb-0 text-text-primary'>
        {t('workflow.globalVar.title')}
        <div className='flex items-center'>
          <div
            className='flex h-6 w-6 cursor-pointer items-center justify-center'
            onClick={() => setShowPanel(false)}
          >
            <RiCloseLine className='h-4 w-4 text-text-tertiary' />
          </div>
        </div>
      </div>
      <div className='system-sm-regular shrink-0 px-4 py-1 text-text-tertiary'>{t('workflow.globalVar.description')}</div>

      <div className='mt-4 grow overflow-y-auto rounded-b-2xl px-4'>
        {globalVariableList.map(item => (
          <Item
            key={item.name}
            payload={item}
          />
        ))}
      </div>
    </div>
  )
}

export default memo(Panel)
