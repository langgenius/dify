import type { FC } from 'react'
import type { IterationNodeType } from './types'
import type { NodePanelProps } from '@/app/components/workflow/types'
import { Select, SelectContent, SelectItem, SelectItemIndicator, SelectItemText, SelectTrigger } from '@langgenius/dify-ui/select'
import { Slider } from '@langgenius/dify-ui/slider'
import { Switch } from '@langgenius/dify-ui/switch'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Input from '@/app/components/base/input'
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
  const selectedResponseMethod = responseMethod.find(item => item.value === inputs.error_handle_mode)

  return (
    <div className="pt-2 pb-2">
      <div className="space-y-4 px-4 pb-4">
        <Field
          title={t(`${i18nPrefix}.input`, { ns: 'workflow' })}
          required
          operations={(
            <div className="flex h-[18px] items-center rounded-[5px] border border-divider-deep px-1 system-2xs-medium-uppercase text-text-tertiary capitalize">Array</div>
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
            <div className="flex h-[18px] items-center rounded-[5px] border border-divider-deep px-1 system-2xs-medium-uppercase text-text-tertiary capitalize">Array</div>
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
          <Switch checked={inputs.is_parallel} onCheckedChange={changeParallel} />
        </Field>
      </div>
      {
        inputs.is_parallel && (
          <div className="px-4 pb-2">
            <Field title={t(`${i18nPrefix}.MaxParallelismTitle`, { ns: 'workflow' })} isSubTitle tooltip={<div className="w-[230px]">{t(`${i18nPrefix}.MaxParallelismDesc`, { ns: 'workflow' })}</div>}>
              <div className="row flex">
                <Input type="number" wrapperClassName="w-18 mr-4" max={MAX_PARALLEL_LIMIT} min={MIN_ITERATION_PARALLEL_NUM} value={inputs.parallel_nums} onChange={(e) => { changeParallelNums(Number(e.target.value)) }} />
                <Slider
                  value={inputs.parallel_nums}
                  onValueChange={changeParallelNums}
                  max={MAX_PARALLEL_LIMIT}
                  min={MIN_ITERATION_PARALLEL_NUM}
                  className="mt-4 flex-1 shrink-0"
                  aria-label={t(`${i18nPrefix}.MaxParallelismTitle`, { ns: 'workflow' })}
                />
              </div>

            </Field>
          </div>
        )
      }
      <Split />

      <div className="px-4 py-2">
        <Field title={t(`${i18nPrefix}.errorResponseMethod`, { ns: 'workflow' })}>
          <Select
            value={selectedResponseMethod ? String(selectedResponseMethod.value) : null}
            onValueChange={(nextValue) => {
              if (!nextValue)
                return
              const nextItem = responseMethod.find(item => String(item.value) === nextValue)
              if (nextItem)
                changeErrorResponseMode(nextItem)
            }}
          >
            <SelectTrigger className="w-full">
              {selectedResponseMethod?.name ?? t('placeholder.select', { ns: 'common' })}
            </SelectTrigger>
            <SelectContent>
              {responseMethod.map(item => (
                <SelectItem key={item.value} value={String(item.value)}>
                  <SelectItemText>{item.name}</SelectItemText>
                  <SelectItemIndicator />
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>

      <Split />

      <div className="px-4 py-2">
        <Field
          title={t(`${i18nPrefix}.flattenOutput`, { ns: 'workflow' })}
          tooltip={<div className="w-[230px]">{t(`${i18nPrefix}.flattenOutputDesc`, { ns: 'workflow' })}</div>}
          inline
        >
          <Switch checked={inputs.flatten_output} onCheckedChange={changeFlattenOutput} />
        </Field>
      </div>
    </div>
  )
}

export default React.memo(Panel)
