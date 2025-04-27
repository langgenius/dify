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
import {
  RiErrorWarningFill,
  RiMoreLine,
} from '@remixicon/react'
import { useSelectOrDelete } from '../../hooks'
import type { WorkflowNodesMap } from './node'
import { WorkflowVariableBlockNode } from './node'
import {
  DELETE_WORKFLOW_VARIABLE_BLOCK_COMMAND,
  UPDATE_WORKFLOW_NODES_MAP,
} from './index'
import cn from '@/utils/classnames'
import { Variable02 } from '@/app/components/base/icons/src/vender/solid/development'
import { BubbleX, Env } from '@/app/components/base/icons/src/vender/line/others'
import { VarBlockIcon } from '@/app/components/workflow/block-icon'
import { Line3 } from '@/app/components/base/icons/src/public/common'
import { isConversationVar, isENV, isSystemVar } from '@/app/components/workflow/nodes/_base/components/variable/utils'
import Tooltip from '@/app/components/base/tooltip'
import { isExceptionVariable } from '@/app/components/workflow/utils'
import VarFullPathPanel from '@/app/components/workflow/nodes/_base/components/variable/var-full-path-panel'
import { Type } from '@/app/components/workflow/nodes/llm/types'
import type { ValueSelector } from '@/app/components/workflow/types'

type WorkflowVariableBlockComponentProps = {
  nodeKey: string
  variables: string[]
  workflowNodesMap: WorkflowNodesMap
  getVarType?: (payload: {
    nodeId: string,
    valueSelector: ValueSelector,
  }) => Type
}

const WorkflowVariableBlockComponent = ({
  nodeKey,
  variables,
  workflowNodesMap = {},
  getVarType,
}: WorkflowVariableBlockComponentProps) => {
  const { t } = useTranslation()
  const [editor] = useLexicalComposerContext()
  const [ref, isSelected] = useSelectOrDelete(nodeKey, DELETE_WORKFLOW_VARIABLE_BLOCK_COMMAND)
  const variablesLength = variables.length
  const isShowAPart = variablesLength > 2
  const varName = (
    () => {
      const isSystem = isSystemVar(variables)
      const varName = variables[variablesLength - 1]
      return `${isSystem ? 'sys.' : ''}${varName}`
    }
  )()
  const [localWorkflowNodesMap, setLocalWorkflowNodesMap] = useState<WorkflowNodesMap>(workflowNodesMap)
  const node = localWorkflowNodesMap![variables[0]]
  const isEnv = isENV(variables)
  const isChatVar = isConversationVar(variables)
  const isException = isExceptionVariable(varName, node?.type)

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
        'group/wrap relative mx-0.5 flex h-[18px] select-none items-center rounded-[5px] border pl-0.5 pr-[3px] hover:border-state-accent-solid hover:bg-state-accent-hover',
        isSelected ? ' border-state-accent-solid bg-state-accent-hover' : ' border-components-panel-border-subtle bg-components-badge-white-to-dark',
        !node && !isEnv && !isChatVar && '!border-state-destructive-solid !bg-state-destructive-hover',
      )}
      ref={ref}
    >
      {!isEnv && !isChatVar && (
        <div className='flex items-center'>
          {
            node?.type && (
              <div className='p-[1px]'>
                <VarBlockIcon
                  className='!text-text-secondary'
                  type={node?.type}
                />
              </div>
            )
          }
          <div className='mx-0.5 max-w-[60px] shrink-0 truncate text-xs font-medium text-text-secondary' title={node?.title} style={{
          }}>{node?.title}</div>
          <Line3 className='mr-0.5 text-divider-deep'></Line3>
        </div>
      )}
      {isShowAPart && (
        <div className='flex items-center'>
          <RiMoreLine className='h-3 w-3 text-text-secondary' />
          <Line3 className='mr-0.5 text-divider-deep'></Line3>
        </div>
      )}

      <div className='flex items-center text-text-accent'>
        {!isEnv && !isChatVar && <Variable02 className={cn('h-3.5 w-3.5 shrink-0', isException && 'text-text-warning')} />}
        {isEnv && <Env className='h-3.5 w-3.5 shrink-0 text-util-colors-violet-violet-600' />}
        {isChatVar && <BubbleX className='h-3.5 w-3.5 text-util-colors-teal-teal-700' />}
        <div className={cn(
          'ml-0.5 shrink-0 truncate text-xs font-medium',
          isEnv && 'text-util-colors-violet-violet-600',
          isChatVar && 'text-util-colors-teal-teal-700',
          isException && 'text-text-warning',
        )} title={varName}>{varName}</div>
        {
          !node && !isEnv && !isChatVar && (
            <RiErrorWarningFill className='ml-0.5 h-3 w-3 text-text-destructive' />
          )
        }
      </div>
    </div>
  )

  if (!node && !isEnv && !isChatVar) {
    return (
      <Tooltip popupContent={t('workflow.errorMsg.invalidVariable')}>
        {Item}
      </Tooltip>
    )
  }

  if (!node)
    return Item

  return (
    <Tooltip
      noDecoration
      popupContent={
        <VarFullPathPanel
          nodeName={node.title}
          path={variables.slice(1)}
          varType={getVarType ? getVarType({
            nodeId: variables[0],
            valueSelector: variables,
          }) : Type.string}
          nodeType={node?.type}
        />}
      disabled={!isShowAPart}
    >
      <div>{Item}</div>
    </Tooltip>
  )
}

export default memo(WorkflowVariableBlockComponent)
