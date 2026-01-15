import type { FC } from 'react'
import type { IterationNodeType } from './types'
import type { NodePanelProps } from '@/app/components/workflow/types'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Input from '@/app/components/base/input'
import Select from '@/app/components/base/select'
import Slider from '@/app/components/base/slider'
import Switch from '@/app/components/base/switch'
import Field from '@/app/components/workflow/nodes/_base/components/field'
import { ErrorHandleMode } from '@/app/components/workflow/types'
import { MAX_PARALLEL_LIMIT } from '@/config'
import { MIN_ITERATION_PARALLEL_NUM } from '../../constants'
import Split from '../_base/components/split'
import VarReferencePicker from '../_base/components/variable/var-reference-picker'
import useConfig from './use-config'

const i18nPrefix = 'nodes.iteration'

const Panel: FC<NodePanelProps<IterationNodeType>> = ({
  id,
  data,
}) => {
  const { t } = useTranslation()
  const responseMethod = [
    {
      value: ErrorHandleMode.Terminated,
      name: t(`${i18nPrefix}.ErrorMethod.operationTerminated`, { ns: 'workflow' }),
    },
    {
      value: ErrorHandleMode.ContinueOnError,
      name: t(`${i18nPrefix}.ErrorMethod.continueOnError`, { ns: 'workflow' }),
    },
    {
      value: ErrorHandleMode.RemoveAbnormalOutput,
      name: t(`${i18nPrefix}.ErrorMethod.removeAbnormalOutput`, { ns: 'workflow' }),
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
    changeParallel,
    changeErrorResponseMode,
    changeParallelNums,
    changeFlattenOutput,
  } = useConfig(id, data)

  return (
    <div className="pb-2 pt-2">
      <div className="space-y-4 px-4 pb-4">
        <Field
          title={t(`${i18nPrefix}.input`, { ns: 'workflow' })}
          required
          operations={(
            <div className="system-2xs-medium-uppercase flex h-[18px] items-center rounded-[5px] border border-divider-deep px-1 capitalize text-text-tertiary">Array</div>
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
      <div className="mt-2 space-y-4 px-4 pb-4">
        <Field
          title={t(`${i18nPrefix}.output`, { ns: 'workflow' })}
          required
          operations={(
            <div className="system-2xs-medium-uppercase flex h-[18px] items-center rounded-[5px] border border-divider-deep px-1 capitalize text-text-tertiary">Array</div>
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
      <div className="px-4 pb-2">
        <Field title={t(`${i18nPrefix}.parallelMode`, { ns: 'workflow' })} tooltip={<div className="w-[230px]">{t(`${i18nPrefix}.parallelPanelDesc`, { ns: 'workflow' })}</div>} inline>
          <Switch defaultValue={inputs.is_parallel} onChange={changeParallel} />
        </Field>
      </div>
      {
        inputs.is_parallel && (
          <div className="px-4 pb-2">
            <Field title={t(`${i18nPrefix}.MaxParallelismTitle`, { ns: 'workflow' })} isSubTitle tooltip={<div className="w-[230px]">{t(`${i18nPrefix}.MaxParallelismDesc`, { ns: 'workflow' })}</div>}>
              <div className="row flex">
                <Input type="number" wrapperClassName="w-18 mr-4 " max={MAX_PARALLEL_LIMIT} min={MIN_ITERATION_PARALLEL_NUM} value={inputs.parallel_nums} onChange={(e) => { changeParallelNums(Number(e.target.value)) }} />
                <Slider
                  value={inputs.parallel_nums}
                  onChange={changeParallelNums}
                  max={MAX_PARALLEL_LIMIT}
                  min={MIN_ITERATION_PARALLEL_NUM}
                  className=" mt-4 flex-1 shrink-0"
                />
              </div>

            </Field>
          </div>
        )
      }
      <Split />

      <div className="px-4 py-2">
        <Field title={t(`${i18nPrefix}.errorResponseMethod`, { ns: 'workflow' })}>
          <Select items={responseMethod} defaultValue={inputs.error_handle_mode} onSelect={changeErrorResponseMode} allowSearch={false} />
        </Field>
      </div>

      <Split />

      <div className="px-4 py-2">
        <Field
          title={t(`${i18nPrefix}.flattenOutput`, { ns: 'workflow' })}
          tooltip={<div className="w-[230px]">{t(`${i18nPrefix}.flattenOutputDesc`, { ns: 'workflow' })}</div>}
          inline
        >
          <Switch defaultValue={inputs.flatten_output} onChange={changeFlattenOutput} />
        </Field>
      </div>
    </div>
  )
}

export default React.memo(Panel)
