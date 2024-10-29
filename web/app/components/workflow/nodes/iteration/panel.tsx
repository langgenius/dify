import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiArrowRightSLine,
} from '@remixicon/react'
import VarReferencePicker from '../_base/components/variable/var-reference-picker'
import Split from '../_base/components/split'
import ResultPanel from '../../run/result-panel'
import IterationResultPanel from '../../run/iteration-result-panel'
import { MAX_ITERATION_PARALLEL_NUM, MIN_ITERATION_PARALLEL_NUM } from '../../constants'
import type { IterationNodeType } from './types'
import useConfig from './use-config'
import { ErrorHandleMode, InputVarType, type NodePanelProps } from '@/app/components/workflow/types'
import Field from '@/app/components/workflow/nodes/_base/components/field'
import BeforeRunForm from '@/app/components/workflow/nodes/_base/components/before-run-form'
import Switch from '@/app/components/base/switch'
import Select from '@/app/components/base/select'
import Slider from '@/app/components/base/slider'
import Input from '@/app/components/base/input'
import Divider from '@/app/components/base/divider'

const i18nPrefix = 'workflow.nodes.iteration'

const Panel: FC<NodePanelProps<IterationNodeType>> = ({
  id,
  data,
}) => {
  const { t } = useTranslation()
  const responseMethod = [
    {
      value: ErrorHandleMode.Terminated,
      name: t(`${i18nPrefix}.ErrorMethod.operationTerminated`),
    },
    {
      value: ErrorHandleMode.ContinueOnError,
      name: t(`${i18nPrefix}.ErrorMethod.continueOnError`),
    },
    {
      value: ErrorHandleMode.RemoveAbnormalOutput,
      name: t(`${i18nPrefix}.ErrorMethod.removeAbnormalOutput`),
    },
  ]
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
    changeParallel,
    changeErrorResponseMode,
    changeParallelNums,
  } = useConfig(id, data)

  return (
    <div className='mt-2'>
      <div className='px-4 pb-4 space-y-4'>
        <Field
          title={t(`${i18nPrefix}.input`)}
          operations={(
            <div className='flex items-center h-[18px] px-1 border border-black/8 rounded-[5px] text-xs font-medium text-gray-500 capitalize'>Array</div>
          )}
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
      <div className='px-4 pb-2'>
        <Field title={t(`${i18nPrefix}.parallelMode`)} tooltip={<div className='w-[230px]'>{t(`${i18nPrefix}.parallelPanelDesc`)}</div>} inline>
          <Switch defaultValue={inputs.is_parallel} onChange={changeParallel} />
        </Field>
      </div>
      {
        inputs.is_parallel && (<div className='px-4 pb-2'>
          <Field title={t(`${i18nPrefix}.MaxParallelismTitle`)} isSubTitle tooltip={<div className='w-[230px]'>{t(`${i18nPrefix}.MaxParallelismDesc`)}</div>}>
            <div className='flex row'>
              <Input type='number' wrapperClassName='w-18 mr-4 ' max={MAX_ITERATION_PARALLEL_NUM} min={MIN_ITERATION_PARALLEL_NUM} value={inputs.parallel_nums} onChange={(e) => { changeParallelNums(Number(e.target.value)) }} />
              <Slider
                value={inputs.parallel_nums}
                onChange={changeParallelNums}
                max={MAX_ITERATION_PARALLEL_NUM}
                min={MIN_ITERATION_PARALLEL_NUM}
                className=' flex-shrink-0 flex-1 mt-4'
              />
            </div>

          </Field>
        </div>)
      }
      <div className='px-4 py-2'>
        <Divider className='h-[1px]'/>
      </div>

      <div className='px-4 py-2'>
        <Field title={t(`${i18nPrefix}.errorResponseMethod`)} >
          <Select items={responseMethod} defaultValue={inputs.error_handle_mode} onSelect={changeErrorResponseMode} allowSearch={false}>
          </Select>
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
                  <RiArrowRightSLine className='w-3.5 h-3.5 text-gray-500' />
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
