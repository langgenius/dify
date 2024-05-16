import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'

import VarReferencePicker from '../_base/components/variable/var-reference-picker'
import Split from '../_base/components/split'
import ResultPanel from '../../run/result-panel'
import IterationResultPanel from '../../run/iteration-result-panel'
import type { IterationNodeType } from './types'
import useConfig from './use-config'
import mockIterationRunData from './mock-iteration-run-data'
import { InputVarType, type NodePanelProps } from '@/app/components/workflow/types'
import Field from '@/app/components/app/configuration/config-var/config-modal/field'
import BeforeRunForm from '@/app/components/workflow/nodes/_base/components/before-run-form'

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
    runningStatus,
    handleRun,
    handleStop,
    runResult,
    inputVarValues,
    setInputVarValues,
    usedOutVars,
    iterator,
    setIterator,
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
      <div className='px-4 pb-4 space-y-4'>
        <Field
          title={t(`${i18nPrefix}.output`)}
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
                variable: '#iterator#',
                type: InputVarType.iterator,
                required: false,
              }],
              values: { '#iterator#': iterator },
              onChange: keyValue => setIterator((keyValue as any)['#iterator#']),
            },
          ]}
          runningStatus={runningStatus}
          onRun={handleRun}
          onStop={handleStop}
          result={<ResultPanel {...runResult} showSteps={false} />}
        />
      )}
      {true && (
        <IterationResultPanel
          onHide={hideSingleRun}
          list={mockIterationRunData}
        />
      )}
    </div>
  )
}

export default React.memo(Panel)
