'use client'
import type { FC } from 'react'
import type { Item } from '@/app/components/base/select'
import type { NestedNodeConfig } from '@/app/components/workflow/nodes/_base/types'
import type { Node, NodeOutPutVar, ValueSelector } from '@/app/components/workflow/types'
import { RiCheckLine } from '@remixicon/react'
import { memo, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SimpleSelect } from '@/app/components/base/select'
import CodeEditor from '@/app/components/workflow/nodes/_base/components/editor/code-editor'
import Field from '@/app/components/workflow/nodes/_base/components/field'
import VarReferencePicker from '@/app/components/workflow/nodes/_base/components/variable/var-reference-picker'
import Tab, { TabType } from '@/app/components/workflow/nodes/_base/components/workflow-panel/tab'
import { CodeLanguage } from '@/app/components/workflow/nodes/code/types'
import { cn } from '@/utils/classnames'

type ConfigPanelProps = {
  agentName: string
  extractorNodeId: string
  nestedNodeConfig: NestedNodeConfig
  availableNodes: Node[]
  availableVars: NodeOutPutVar[]
  onNestedNodeConfigChange: (config: NestedNodeConfig) => void
}

const ConfigPanel: FC<ConfigPanelProps> = ({
  agentName,
  extractorNodeId,
  nestedNodeConfig,
  availableNodes,
  availableVars,
  onNestedNodeConfigChange,
}) => {
  const { t } = useTranslation()
  const [tabType, setTabType] = useState<TabType>(TabType.settings)

  const resolvedExtractorId = nestedNodeConfig.extractor_node_id || extractorNodeId

  const selectedOutput = useMemo<ValueSelector>(() => {
    if (!resolvedExtractorId || !nestedNodeConfig.output_selector?.length)
      return []

    return [resolvedExtractorId, ...(nestedNodeConfig.output_selector || [])]
  }, [nestedNodeConfig.output_selector, resolvedExtractorId])

  const handleOutputVarChange = useCallback((value: ValueSelector | string) => {
    const selector = Array.isArray(value) ? value : []
    const nextExtractorId = selector[0] || resolvedExtractorId
    const nextOutputSelector = selector.length > 1 ? selector.slice(1) : []

    onNestedNodeConfigChange({
      ...nestedNodeConfig,
      extractor_node_id: nextExtractorId,
      output_selector: nextOutputSelector,
    })
  }, [nestedNodeConfig, onNestedNodeConfigChange, resolvedExtractorId])

  const whenOutputNoneOptions = useMemo(() => ([
    {
      value: 'raise_error',
      name: t('subGraphModal.whenOutputNone.error', { ns: 'workflow' }),
      description: t('subGraphModal.whenOutputNone.errorDesc', { ns: 'workflow' }),
    },
    {
      value: 'use_default',
      name: t('subGraphModal.whenOutputNone.default', { ns: 'workflow' }),
      description: t('subGraphModal.whenOutputNone.defaultDesc', { ns: 'workflow' }),
    },
  ]), [t])
  const selectedWhenOutputNoneOption = useMemo(() => (
    whenOutputNoneOptions.find(item => item.value === nestedNodeConfig.null_strategy) ?? whenOutputNoneOptions[0]
  ), [nestedNodeConfig.null_strategy, whenOutputNoneOptions])

  const handleNullStrategyChange = useCallback((item: Item) => {
    if (typeof item.value !== 'string')
      return
    onNestedNodeConfigChange({
      ...nestedNodeConfig,
      null_strategy: item.value as NestedNodeConfig['null_strategy'],
    })
  }, [nestedNodeConfig, onNestedNodeConfigChange])

  const handleDefaultValueChange = useCallback((value: string) => {
    const trimmed = value.trim()
    let nextValue: unknown = value
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        nextValue = JSON.parse(trimmed)
      }
      catch {
        nextValue = value
      }
    }

    onNestedNodeConfigChange({
      ...nestedNodeConfig,
      default_value: nextValue,
    })
  }, [nestedNodeConfig, onNestedNodeConfigChange])
  const defaultValue = nestedNodeConfig.default_value ?? ''
  const shouldFormatDefaultValue = typeof defaultValue !== 'string'

  return (
    <div className="flex h-full flex-col">
      <div className="px-4 pb-2 pt-4">
        <div className="system-lg-semibold text-text-primary">
          {t('subGraphModal.internalStructure', { ns: 'workflow' })}
        </div>
        <div className="system-sm-regular text-text-tertiary">
          {t('subGraphModal.internalStructureDesc', { ns: 'workflow', name: agentName })}
        </div>
      </div>
      <div className="px-4 pb-2">
        <Tab value={tabType} onChange={setTabType} />
      </div>
      {tabType === TabType.lastRun && (
        <div className="flex flex-1 items-center justify-center p-4">
          <p className="system-sm-regular text-text-tertiary">
            {t('subGraphModal.noRunHistory', { ns: 'workflow' })}
          </p>
        </div>
      )}
      {tabType === TabType.settings && (
        <div className="flex-1 overflow-y-auto">
          <div className="space-y-4 px-4 py-4">
            <Field title={t('subGraphModal.outputVariables', { ns: 'workflow' })}>
              <VarReferencePicker
                nodeId={extractorNodeId}
                readonly={false}
                isShowNodeName
                value={selectedOutput}
                onChange={handleOutputVarChange}
                availableNodes={availableNodes}
                availableVars={availableVars}
              />
            </Field>
          </div>
          <div className="space-y-4 px-4 py-4">
            <Field
              title={t('subGraphModal.whenOutputIsNone', { ns: 'workflow' })}
              operations={(
                <div className="flex items-center">
                  <SimpleSelect
                    items={whenOutputNoneOptions}
                    defaultValue={nestedNodeConfig.null_strategy}
                    allowSearch={false}
                    notClearable
                    wrapperClassName="min-w-[160px]"
                    onSelect={handleNullStrategyChange}
                    renderOption={({ item, selected }) => (
                      <div className="flex items-start gap-2">
                        <div className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
                          {selected && (
                            <RiCheckLine className="h-4 w-4 text-[14px] text-text-accent" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="system-sm-medium text-text-secondary">{item.name}</div>
                          <div className="system-xs-regular mt-0.5 text-text-tertiary">{item.description}</div>
                        </div>
                      </div>
                    )}
                  />
                </div>
              )}
            >
              <div className="space-y-2">
                {selectedWhenOutputNoneOption?.description && (
                  <div className="system-xs-regular text-text-tertiary">
                    {selectedWhenOutputNoneOption.description}
                  </div>
                )}
                {nestedNodeConfig.null_strategy === 'use_default' && (
                  <div className={cn('overflow-hidden rounded-lg border border-components-input-border-active bg-components-input-bg-normal p-1')}>
                    <CodeEditor
                      noWrapper
                      language={CodeLanguage.json}
                      value={defaultValue}
                      onChange={handleDefaultValueChange}
                      isJSONStringifyBeauty={shouldFormatDefaultValue}
                      className="min-h-[160px]"
                    />
                  </div>
                )}
              </div>
            </Field>
          </div>
        </div>
      )}
    </div>
  )
}

export default memo(ConfigPanel)
