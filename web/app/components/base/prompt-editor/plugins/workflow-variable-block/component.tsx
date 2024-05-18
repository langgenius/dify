import {
  memo,
  useEffect,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  COMMAND_PRIORITY_EDITOR,
} from 'lexical'
import { mergeRegister } from '@lexical/utils'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import cn from 'classnames'
import { useSelectOrDelete } from '../../hooks'
import type { WorkflowNodesMap } from './node'
import { WorkflowVariableBlockNode } from './node'
import {
  DELETE_WORKFLOW_VARIABLE_BLOCK_COMMAND,
  UPDATE_WORKFLOW_NODES_MAP,
} from './index'
import { Variable02 } from '@/app/components/base/icons/src/vender/solid/development'
import { VarBlockIcon } from '@/app/components/workflow/block-icon'
import { Line3 } from '@/app/components/base/icons/src/public/common'
import { isSystemVar } from '@/app/components/workflow/nodes/_base/components/variable/utils'
import { AlertCircle } from '@/app/components/base/icons/src/vender/solid/alertsAndFeedback'
import TooltipPlus from '@/app/components/base/tooltip-plus'

type WorkflowVariableBlockComponentProps = {
  nodeKey: string
  variables: string[]
  workflowNodesMap: WorkflowNodesMap
}

const WorkflowVariableBlockComponent = ({
  nodeKey,
  variables,
  workflowNodesMap = {},
}: WorkflowVariableBlockComponentProps) => {
  const { t } = useTranslation()
  const [editor] = useLexicalComposerContext()
  const [ref, isSelected] = useSelectOrDelete(nodeKey, DELETE_WORKFLOW_VARIABLE_BLOCK_COMMAND)
  const variablesLength = variables.length
  const lastVariable = isSystemVar(variables) ? variables.join('.') : variables[variablesLength - 1]
  const [localWorkflowNodesMap, setLocalWorkflowNodesMap] = useState<WorkflowNodesMap>(workflowNodesMap)
  const node = localWorkflowNodesMap![variables[0]]

  useEffect(() => {
    if (!editor.hasNodes([WorkflowVariableBlockNode]))
      throw new Error('WorkflowVariableBlockPlugin: WorkflowVariableBlock not registered on editor')

    return mergeRegister(
      editor.registerCommand(
        UPDATE_WORKFLOW_NODES_MAP,
        (workflowNodesMap: WorkflowNodesMap) => {
          setLocalWorkflowNodesMap(workflowNodesMap)

          return true
        },
        COMMAND_PRIORITY_EDITOR,
      ),
    )
  }, [editor])

  const Item = (
    <div
      className={cn(
        'mx-0.5 relative group/wrap flex items-center h-[18px] pl-0.5 pr-[3px] rounded-[5px] border select-none',
        isSelected ? ' border-[#84ADFF] bg-[#F5F8FF]' : ' border-black/5 bg-white',
        !node && '!border-[#F04438] !bg-[#FEF3F2]',
      )}
      ref={ref}
    >
      <div className='flex items-center'>
        {
          node?.type && (
            <div className='p-[1px]'>
              <VarBlockIcon
                className='!text-gray-500'
                type={node?.type}
              />
            </div>
          )
        }
        <div className='shrink-0 mx-0.5 text-xs font-medium text-gray-500 truncate' title={node?.title} style={{
        }}>{node?.title}</div>
        <Line3 className='mr-0.5 text-gray-300'></Line3>
      </div>
      <div className='flex items-center text-primary-600'>
        <Variable02 className='w-3.5 h-3.5' />
        <div className='shrink-0 ml-0.5 text-xs font-medium truncate' title={lastVariable}>{lastVariable}</div>
        {
          !node && (
            <AlertCircle className='ml-0.5 w-3 h-3 text-[#D92D20]' />
          )
        }
      </div>
    </div>
  )

  if (!node) {
    return (
      <TooltipPlus popupContent={t('workflow.errorMsg.invalidVariable')}>
        {Item}
      </TooltipPlus>
    )
  }

  return Item
}

export default memo(WorkflowVariableBlockComponent)
