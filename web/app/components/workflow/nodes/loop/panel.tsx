import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiArrowRightSLine,
} from '@remixicon/react'

import Split from '../_base/components/split'
import ResultPanel from '../../run/result-panel'
import LoopResultPanel from '../../run/loop-result-panel'
import InputNumberWithSlider from '../_base/components/input-number-with-slider'
import type { LoopNodeType } from './types'
import useConfig from './use-config'
import ConditionWrap from './components/condition-wrap'
import { type NodePanelProps } from '@/app/components/workflow/types'
import BeforeRunForm from '@/app/components/workflow/nodes/_base/components/before-run-form'
import Field from '@/app/components/workflow/nodes/_base/components/field'

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
    isShowLoopDetail,
    backToSingleRun,
    showLoopDetail,
    hideLoopDetail,
    runningStatus,
    handleRun,
    handleStop,
    runResult,
    inputVarValues,
    setInputVarValues,
    usedOutVars,
    loop,
    setLoop,
    loopInputKey,
    loopRunResult,
    filterVar,
    handleAddCondition,
    handleUpdateCondition,
    handleRemoveCondition,
    handleToggleConditionLogicalOperator,
    handleAddSubVariableCondition,
    handleRemoveSubVariableCondition,
    handleUpdateSubVariableCondition,
    handleToggleSubVariableConditionLogicalOperator,
    nodesOutputVars,
    varsIsVarFileAttribute,
    handleUpdateLoopCount,
  } = useConfig(id, data)

  return (
    <div className='mt-2'>
      <div>
        <Field
          title={<div className='pl-3'>{t(`${i18nPrefix}.breakCondition`)}</div>}
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
            nodesOutputVars={nodesOutputVars}
            availableNodes={loopChildrenNodes}
            availableVars={childrenNodeVars}
            varsIsVarFileAttribute={varsIsVarFileAttribute}
            filterVar={filterVar}
            conditions={inputs.break_conditions || []}
            logicalOperator={inputs.logical_operator!}
          />
        </Field>
        <Split />
        <div className='mt-2'>
          <Field
            title={<div className='pl-3'>{t(`${i18nPrefix}.loopMaxCount`)}</div>}
          >
            <div className='px-3 py-2'>
              <InputNumberWithSlider
                min={1}
                max={100}
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
      {isShowSingleRun && (
        <BeforeRunForm
          nodeName={inputs.title}
          onHide={hideSingleRun}
          forms={[
            {
              inputs: [...usedOutVars],
              values: inputVarValues,
              onChange: setInputVarValues,
            },
          ]}
          runningStatus={runningStatus}
          onRun={handleRun}
          onStop={handleStop}
          result={
            <div className='mt-3'>
              <div className='px-4'>
                <div className='flex items-center h-[34px] justify-between px-3 bg-gray-100 border-[0.5px] border-gray-200 rounded-lg cursor-pointer' onClick={showLoopDetail}>
                  <div className='leading-[18px] text-[13px] font-medium text-gray-700'>{t(`${i18nPrefix}.loop`, { count: loopRunResult.length })}</div>
                  <RiArrowRightSLine className='w-3.5 h-3.5 text-gray-500' />

                </div>
                <Split className='mt-3' />
              </div>
              <ResultPanel {...runResult} showSteps={false} />
            </div>
          }
        />
      )}
      {isShowLoopDetail && (
        <LoopResultPanel
          onBack={backToSingleRun}
          onHide={hideLoopDetail}
          list={loopRunResult}
        />
      )}
    </div>
  )
}

export default React.memo(Panel)
