import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'

import VarReferencePicker from '../_base/components/variable/var-reference-picker'
import Split from '../_base/components/split'
import ResultPanel from '../../run/result-panel'
import IterationResultPanel from '../../run/iteration-result-panel'
import type { IterationNodeType } from './types'
import useConfig from './use-config'
import { InputVarType, type NodePanelProps } from '@/app/components/workflow/types'
import Field from '@/app/components/workflow/nodes/_base/components/field'
import BeforeRunForm from '@/app/components/workflow/nodes/_base/components/before-run-form'
import { ArrowNarrowRight } from '@/app/components/base/icons/src/vender/line/arrows'

const i18nPrefix = 'workflow.nodes.iteration'

const Panel: FC<NodePanelProps<IterationNodeType>> = ({
  id,
  data,
}) => {
  const { t } = useTranslation()

  const {
    readOnly,
    inputs,
    filterInputVar,
    handleInputChange,
    childrenNodeVars,
    iterationChildrenNodes,
    handleOutputVarChange,
    isShowSingleRun,
    hideSingleRun,
    isShowIterationDetail,
    backToSingleRun,
    showIterationDetail,
    hideIterationDetail,
    runningStatus,
    handleRun,
    handleStop,
    runResult,
    inputVarValues,
    setInputVarValues,
    usedOutVars,
    iterator,
    setIterator,
    iteratorInputKey,
    iterationRunResult,
  } = useConfig(id, data)

  return (
    <div className='mt-2'>
      <div className='px-4 pb-4 space-y-4'>
        <Field
          title={t(`${i18nPrefix}.input`)}
        >
          <VarReferencePicker
            readonly={readOnly}
            nodeId={id}
            isShowNodeName
            value={inputs.iterator_selector || []}
            onChange={handleInputChange}
            filterVar={filterInputVar}
          />
        </Field>
      </div>
      <Split />
      <div className='mt-2 px-4 pb-4 space-y-4'>
        <Field
          title={t(`${i18nPrefix}.output`)}
          operations={(
            <div className='flex items-center h-[18px] px-1 border border-black/8 rounded-[5px] text-xs font-medium text-gray-500 capitalize'>Array</div>
          )}
        >
          <VarReferencePicker
            readonly={readOnly}
            nodeId={id}
            isShowNodeName
            value={inputs.output_selector || []}
            onChange={handleOutputVarChange}
            availableNodes={iterationChildrenNodes}
            availableVars={childrenNodeVars}
          />
        </Field>
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
            {
              label: t(`${i18nPrefix}.input`)!,
              inputs: [{
                label: '',
                variable: iteratorInputKey,
                type: InputVarType.iterator,
                required: false,
              }],
              values: { [iteratorInputKey]: iterator },
              onChange: keyValue => setIterator((keyValue as any)[iteratorInputKey]),
            },
          ]}
          runningStatus={runningStatus}
          onRun={handleRun}
          onStop={handleStop}
          result={
            <div className='mt-3'>
              <div className='px-4'>
                <div className='flex items-center h-[34px] justify-between px-3 bg-gray-100 border-[0.5px] border-gray-200 rounded-lg cursor-pointer' onClick={showIterationDetail}>
                  <div className='leading-[18px] text-[13px] font-medium text-gray-700'>{t(`${i18nPrefix}.iteration`, { count: iterationRunResult.length })}</div>
                  <ArrowNarrowRight className='w-3.5 h-3.5 text-gray-500' />
                </div>
                <Split className='mt-3' />
              </div>
              <ResultPanel {...runResult} showSteps={false} />
            </div>
          }
        />
      )}
      {isShowIterationDetail && (
        <IterationResultPanel
          onBack={backToSingleRun}
          onHide={hideIterationDetail}
          list={iterationRunResult}
        />
      )}
    </div>
  )
}

export default React.memo(Panel)
