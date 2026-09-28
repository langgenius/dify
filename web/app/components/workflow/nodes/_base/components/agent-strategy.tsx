import type {
  AgentStrategyEntity,
  AgentStrategyParameter,
  AgentStrategyParameterType,
  Meta,
} from '@dify/contracts/api/console/workspaces/types.gen'
import type { ComponentProps } from 'react'
import type { Node } from 'reactflow'
import type { NodeOutPutVar } from '../../../types'
import type { CredentialFormSchema } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { Fieldset, FieldsetLegend } from '@langgenius/dify-ui/fieldset'
import {
  NumberField,
  NumberFieldControls,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
} from '@langgenius/dify-ui/number-field'
import {
  Slider,
  SliderControl,
  SliderIndicator,
  SliderLabel,
  SliderThumb,
  SliderTrack,
} from '@langgenius/dify-ui/slider'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import ListEmpty from '@/app/components/base/list-empty'
import {
  FormTypeEnum,
  ModelTypeEnum,
} from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useDefaultModel } from '@/app/components/header/account-setting/model-provider-page/hooks'
import Form from '@/app/components/header/account-setting/model-provider-page/model-modal/Form'
import { useDocLink } from '@/context/i18n'
import { useRenderI18nObject } from '@/hooks/use-i18n'
import Link from '@/next/link'
import { AppModeEnum } from '@/types/app'
import { useWorkflowStore } from '../../../store'
import { AgentStrategySelector } from './agent-strategy-selector'
import Field from './field'
import Editor from './prompt/editor'

export type Strategy = {
  agent_strategy_provider_name: string
  agent_strategy_name: string
  agent_strategy_label: string
  agent_output_schema: AgentStrategyEntity['output_schema']
  plugin_unique_identifier?: string
  meta?: Meta
}

type AgentStrategyProps = {
  strategy?: Strategy
  onStrategyChange: (strategy?: Strategy) => void
  formSchema: AgentStrategyParameter[]
  formValue: Record<string, unknown>
  onFormValueChange: (value: Record<string, unknown>) => void
  nodeOutputVars?: NodeOutPutVar[]
  availableNodes?: Node[]
  nodeId?: string
}

const fieldTypes: Record<AgentStrategyParameterType, FormTypeEnum> = {
  string: FormTypeEnum.textInput,
  number: FormTypeEnum.textNumber,
  boolean: FormTypeEnum.checkbox,
  select: FormTypeEnum.select,
  'secret-input': FormTypeEnum.secretInput,
  file: FormTypeEnum.file,
  files: FormTypeEnum.files,
  'system-files': FormTypeEnum.files,
  'app-selector': FormTypeEnum.appSelector,
  'model-selector': FormTypeEnum.modelSelector,
  'array[tools]': FormTypeEnum.multiToolSelector,
  any: FormTypeEnum.any,
}

export const AgentStrategy = memo((props: AgentStrategyProps) => {
  const {
    strategy,
    onStrategyChange,
    formSchema,
    formValue,
    onFormValueChange,
    nodeOutputVars,
    availableNodes,
    nodeId,
  } = props
  const { t } = useTranslation(['workflowAgent'])
  const docLink = useDocLink()
  const defaultModel = useDefaultModel(ModelTypeEnum.textGeneration)
  const renderI18nObject = useRenderI18nObject()
  const workflowStore = useWorkflowStore()
  const { setControlPromptEditorRerenderKey } = workflowStore.getState()

  const formSchemas: CredentialFormSchema[] = formSchema.map((parameter) => ({
    name: parameter.name,
    variable: parameter.name,
    type: fieldTypes[parameter.type],
    label: { en_US: renderI18nObject(parameter.label), zh_Hans: renderI18nObject(parameter.label) },
    required: parameter.required ?? false,
    show_on: [],
    tooltip: parameter.help
      ? { en_US: renderI18nObject(parameter.help), zh_Hans: renderI18nObject(parameter.help) }
      : undefined,
    placeholder: parameter.placeholder
      ? {
          en_US: renderI18nObject(parameter.placeholder),
          zh_Hans: renderI18nObject(parameter.placeholder),
        }
      : undefined,
    scope: parameter.scope ?? undefined,
    min: parameter.min ?? undefined,
    max: parameter.max ?? undefined,
    options: (parameter.options ?? []).map((option) => ({
      value: option.value,
      label: { en_US: renderI18nObject(option.label), zh_Hans: renderI18nObject(option.label) },
      show_on: [],
    })),
  }))
  const values = { ...formValue }
  for (const parameter of formSchema) {
    if (values[parameter.name] === undefined && parameter.default !== undefined)
      values[parameter.name] = parameter.default
  }

  const override: ComponentProps<typeof Form>['override'] = [
    [FormTypeEnum.textNumber, FormTypeEnum.textInput],
    (schema, props) => {
      const parameter = formSchema.find((item) => item.name === schema.variable)
      if (!parameter) return false
      switch (schema.type) {
        case FormTypeEnum.textInput: {
          const fieldValue: unknown = props.value[schema.variable]
          const value =
            typeof fieldValue === 'string' && fieldValue !== ''
              ? fieldValue
              : typeof parameter.default === 'string'
                ? parameter.default
                : ''
          const instanceId = schema.variable
          const onChange = (value: string) => {
            props.onChange({ ...props.value, [schema.variable]: value })
          }
          const handleGenerated = (value: string) => {
            onChange(value)
            setControlPromptEditorRerenderKey(Math.random())
          }
          return (
            <Editor
              value={value}
              onChange={onChange}
              onGenerated={handleGenerated}
              instanceId={instanceId}
              key={instanceId}
              title={renderI18nObject(schema.label)}
              headerClassName="bg-transparent px-0 text-text-secondary system-sm-semibold-uppercase"
              containerBackgroundClassName="bg-transparent"
              gradientBorder={false}
              nodeId={nodeId}
              isSupportPromptGenerator={!!parameter.auto_generate?.type}
              titleTooltip={schema.tooltip && renderI18nObject(schema.tooltip)}
              editorContainerClassName="px-0 bg-components-input-bg-normal focus-within:bg-components-input-bg-active rounded-lg"
              availableNodes={availableNodes}
              nodesOutputVars={nodeOutputVars}
              isSupportJinja={parameter.template?.enabled}
              required={parameter.required}
              varList={[]}
              modelConfig={
                defaultModel.data
                  ? {
                      mode: AppModeEnum.CHAT,
                      name: defaultModel.data.model,
                      provider: defaultModel.data.provider.provider,
                      completion_params: {},
                    }
                  : undefined
              }
              placeholderClassName="px-2 py-1"
              titleClassName="system-sm-semibold-uppercase text-text-secondary text-[13px]"
              inputClassName="px-2 py-1"
            />
          )
        }
        case FormTypeEnum.textNumber: {
          if (parameter.max == null || parameter.min == null) return false

          const defaultValue =
            typeof parameter.default === 'number' ||
            (typeof parameter.default === 'string' && parameter.default !== '')
              ? Number(parameter.default)
              : 1
          const fieldValue: unknown = props.value[schema.variable]
          const value =
            typeof fieldValue === 'number' || (typeof fieldValue === 'string' && fieldValue !== '')
              ? Number(fieldValue)
              : defaultValue
          const label = renderI18nObject(parameter.label)
          const onChange = (value: number) => {
            props.onChange({ ...props.value, [schema.variable]: value })
          }
          return (
            <Field
              title={
                <>
                  {label} {parameter.required && <span className="text-red-500">*</span>}
                </>
              }
              key={schema.variable}
              tooltip={schema.tooltip && renderI18nObject(schema.tooltip)}
              inline
            >
              <Fieldset className="flex w-50 items-center gap-3">
                <FieldsetLegend className="sr-only">{label}</FieldsetLegend>
                <Slider
                  value={value}
                  onValueChange={onChange}
                  className="w-full"
                  min={parameter.min}
                  max={parameter.max}
                >
                  <SliderLabel className="sr-only">{label}</SliderLabel>
                  <SliderControl>
                    <SliderTrack>
                      <SliderIndicator />
                      <SliderThumb />
                    </SliderTrack>
                  </SliderControl>
                </Slider>
                <NumberField
                  value={value}
                  min={parameter.min}
                  max={parameter.max}
                  onValueChange={(nextValue) => onChange(nextValue ?? defaultValue)}
                >
                  <NumberFieldGroup>
                    <NumberFieldInput aria-label={label} className="w-12" />
                    <NumberFieldControls>
                      <NumberFieldIncrement />
                      <NumberFieldDecrement />
                    </NumberFieldControls>
                  </NumberFieldGroup>
                </NumberField>
              </Fieldset>
            </Field>
          )
        }
      }
    },
  ]
  return (
    <div className="space-y-2">
      <AgentStrategySelector value={strategy} onChange={onStrategyChange} />
      {strategy ? (
        <div>
          <Form
            formSchemas={formSchemas}
            value={values}
            onChange={onFormValueChange}
            validating={false}
            showOnVariableMap={{}}
            isEditMode={true}
            fieldLabelClassName="uppercase"
            override={override}
            nodeId={nodeId}
            nodeOutputVars={nodeOutputVars || []}
            availableNodes={availableNodes || []}
          />
        </div>
      ) : (
        <ListEmpty
          icon={
            <span
              aria-hidden
              className="i-custom-vender-workflow-agent size-5 shrink-0 text-text-accent"
            />
          }
          title={t(($) => $['nodes.agent.strategy.configureTip'], { ns: 'workflowAgent' })}
          description={
            <div className="text-xs text-text-tertiary">
              {t(($) => $['nodes.agent.strategy.configureTipDesc'], { ns: 'workflowAgent' })} <br />
              <Link
                href={docLink('/use-dify/nodes/agent')}
                className="text-text-accent-secondary"
                target="_blank"
                rel="noopener noreferrer"
              >
                {t(($) => $['nodes.agent.learnMore'], { ns: 'workflowAgent' })}
              </Link>
            </div>
          }
        />
      )}
    </div>
  )
})

AgentStrategy.displayName = 'AgentStrategy'
