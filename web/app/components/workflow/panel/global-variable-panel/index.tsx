import type { GlobalVariable } from '../../types'

import { RiCloseLine } from '@remixicon/react'
import {
  memo,
} from 'react'
import { useTranslation } from 'react-i18next'
import { useStore } from '@/app/components/workflow/store'

import { cn } from '@/utils/classnames'
import { isInWorkflowPage } from '../../constants'
import { useIsChatMode } from '../../hooks'
import Item from './item'

const Panel = () => {
  const { t } = useTranslation()
  const isChatMode = useIsChatMode()
  const setShowPanel = useStore(s => s.setShowGlobalVariablePanel)
  const isWorkflowPage = isInWorkflowPage()

  const globalVariableList: GlobalVariable[] = [
    ...(isChatMode
      ? [{
          name: 'conversation_id',
          value_type: 'string' as const,
          description: t('globalVar.fieldsDescription.conversationId', { ns: 'workflow' }),
        }, {
          name: 'dialog_count',
          value_type: 'number' as const,
          description: t('globalVar.fieldsDescription.dialogCount', { ns: 'workflow' }),
        }]
      : []),
    {
      name: 'user_id',
      value_type: 'string',
      description: t('globalVar.fieldsDescription.userId', { ns: 'workflow' }),
    },
    {
      name: 'app_id',
      value_type: 'string',
      description: t('globalVar.fieldsDescription.appId', { ns: 'workflow' }),
    },
    {
      name: 'workflow_id',
      value_type: 'string',
      description: t('globalVar.fieldsDescription.workflowId', { ns: 'workflow' }),
    },
    {
      name: 'workflow_run_id',
      value_type: 'string',
      description: t('globalVar.fieldsDescription.workflowRunId', { ns: 'workflow' }),
    },
    // is workflow
    ...((isWorkflowPage && !isChatMode)
      ? [{
          name: 'timestamp',
          value_type: 'number' as const,
          description: t('globalVar.fieldsDescription.triggerTimestamp', { ns: 'workflow' }),
        }]
      : []),
  ]

  return (
    <div
      className={cn(
        'relative flex h-full w-[420px] flex-col rounded-l-2xl border border-components-panel-border bg-components-panel-bg-alt',
      )}
    >
      <div className="system-xl-semibold flex shrink-0 items-center justify-between p-4 pb-0 text-text-primary">
        {t('globalVar.title', { ns: 'workflow' })}
        <div className="flex items-center">
          <div
            className="flex h-6 w-6 cursor-pointer items-center justify-center"
            onClick={() => setShowPanel(false)}
          >
            <RiCloseLine className="h-4 w-4 text-text-tertiary" />
          </div>
        </div>
      </div>
      <div className="system-sm-regular shrink-0 px-4 py-1 text-text-tertiary">{t('globalVar.description', { ns: 'workflow' })}</div>

      <div className="mt-4 grow overflow-y-auto rounded-b-2xl px-4">
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
