import type { FC } from 'react'
import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { RiAddLine } from '@remixicon/react'
import Split from '../_base/components/split'
import ResultPanel from '../../run/result-panel'
import InputNumberWithSlider from '../_base/components/input-number-with-slider'
import type { LoopNodeType } from './types'
import useConfig from './use-config'
import ConditionWrap from './components/condition-wrap'
import LoopVariable from './components/loop-variables'
import type { NodePanelProps } from '@/app/components/workflow/types'
import Field from '@/app/components/workflow/nodes/_base/components/field'
import BeforeRunForm from '@/app/components/workflow/nodes/_base/components/before-run-form'
import formatTracing from '@/app/components/workflow/run/utils/format-log'

import { useLogs } from '@/app/components/workflow/run/hooks'
import { LOOP_NODE_MAX_COUNT } from '@/config'

const i18nPrefix = 'workflow.nodes.loop'

const Panel: FC<NodePanelProps<LoopNodeType>> = ({
  id,
  data,
}) => {
  const { t } = useTranslation()

  const {
    readOnly,
    inputs,
    childrenNodeVars,
    loopChildrenNodes,
    isShowSingleRun,
    hideSingleRun,
    runningStatus,
    handleRun,
    handleStop,
    runResult,
    loopRunResult,
    handleAddCondition,
    handleUpdateCondition,
    handleRemoveCondition,
    handleToggleConditionLogicalOperator,
    handleAddSubVariableCondition,
    handleRemoveSubVariableCondition,
    handleUpdateSubVariableCondition,
    handleToggleSubVariableConditionLogicalOperator,
    handleUpdateLoopCount,
    handleAddLoopVariable,
    handleRemoveLoopVariable,
    handleUpdateLoopVariable,
  } = useConfig(id, data)

  const nodeInfo = useMemo(() => {
    const formattedNodeInfo = formatTracing(loopRunResult, t)[0]

    if (runResult && formattedNodeInfo) {
      return {
        ...formattedNodeInfo,
        execution_metadata: {
          ...runResult.execution_metadata,
          ...formattedNodeInfo.execution_metadata,
        },
      }
    }

    return formattedNodeInfo
  }, [runResult, loopRunResult, t])
  const logsParams = useLogs()

  return (
    <div className='mt-2'>
      <div>
        <Field
          title={<div className='pl-3'>{t('workflow.nodes.loop.loopVariables')}</div>}
          operations={
            <div
              className='mr-4 flex h-5 w-5 cursor-pointer items-center justify-center'
              onClick={handleAddLoopVariable}
            >
              <RiAddLine className='h-4 w-4 text-text-tertiary' />
            </div>
          }
        >
          <div className='px-4'>
            <LoopVariable
              variables={inputs.loop_variables}
              nodeId={id}
              handleRemoveLoopVariable={handleRemoveLoopVariable}
              handleUpdateLoopVariable={handleUpdateLoopVariable}
            />
          </div>
        </Field>
        <Split className='my-2' />
        <Field
          title={<div className='pl-3'>{t(`${i18nPrefix}.breakCondition`)}</div>}
          tooltip={t(`${i18nPrefix}.breakConditionTip`)}
        >
          <ConditionWrap
            nodeId={id}
            readOnly={readOnly}
            handleAddCondition={handleAddCondition}
            handleRemoveCondition={handleRemoveCondition}
            handleUpdateCondition={handleUpdateCondition}
            handleToggleConditionLogicalOperator={handleToggleConditionLogicalOperator}
            handleAddSubVariableCondition={handleAddSubVariableCondition}
            handleRemoveSubVariableCondition={handleRemoveSubVariableCondition}
            handleUpdateSubVariableCondition={handleUpdateSubVariableCondition}
            handleToggleSubVariableConditionLogicalOperator={handleToggleSubVariableConditionLogicalOperator}
            availableNodes={loopChildrenNodes}
            availableVars={childrenNodeVars}
            conditions={inputs.break_conditions || []}
            logicalOperator={inputs.logical_operator!}
          />
        </Field>
        <Split className='mt-2' />
        <div className='mt-2'>
          <Field
            title={<div className='pl-3'>{t(`${i18nPrefix}.loopMaxCount`)}</div>}
          >
            <div className='px-3 py-2'>
              <InputNumberWithSlider
                min={1}
                max={LOOP_NODE_MAX_COUNT}
                value={inputs.loop_count}
                onChange={(val) => {
                  const roundedVal = Math.round(val)
                  handleUpdateLoopCount(Number.isNaN(roundedVal) ? 1 : roundedVal)
                }}
              />
            </div>
          </Field>
        </div>
      </div>
      {/* Error handling for the Loop node is currently not considered. */}
      {/* <div className='px-4 py-2'>
        <Field title={t(`${i18nPrefix}.errorResponseMethod`)} >
          <Select items={responseMethod} defaultValue={inputs.error_handle_mode} onSelect={changeErrorResponseMode} allowSearch={false}>
          </Select>
        </Field>
      </div> */}
      {isShowSingleRun && (
        <BeforeRunForm
          nodeName={inputs.title}
          onHide={hideSingleRun}
          forms={[]}
          runningStatus={runningStatus}
          onRun={handleRun}
          onStop={handleStop}
          {...logsParams}
          result={
            <ResultPanel {...runResult} showSteps={false} nodeInfo={nodeInfo} {...logsParams} />
          }
        />
      )}
    </div>
  )
}

export default React.memo(Panel)
