'use client'
import type { FC } from 'react'
import type { NestedNodeConfig } from '@/app/components/workflow/nodes/_base/types'
import type { Node, NodeOutPutVar, ValueSelector } from '@/app/components/workflow/types'
import { RiArrowDownSLine, RiCheckLine } from '@remixicon/react'
import { memo, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import CodeEditor from '@/app/components/workflow/nodes/_base/components/editor/code-editor'
import Field from '@/app/components/workflow/nodes/_base/components/field'
import VarReferencePicker from '@/app/components/workflow/nodes/_base/components/variable/var-reference-picker'
import Tab, { TabType } from '@/app/components/workflow/nodes/_base/components/workflow-panel/tab'
import { NULL_STRATEGY } from '@/app/components/workflow/nodes/_base/constants'
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

  const [nullStrategyOpen, setNullStrategyOpen] = useState(false)
  const whenOutputNoneOptions = useMemo(() => ([
    {
      value: NULL_STRATEGY.RAISE_ERROR,
      label: t('subGraphModal.whenOutputNone.error', { ns: 'workflow' }),
      description: t('subGraphModal.whenOutputNone.errorDesc', { ns: 'workflow' }),
    },
    {
      value: NULL_STRATEGY.USE_DEFAULT,
      label: t('subGraphModal.whenOutputNone.default', { ns: 'workflow' }),
      description: t('subGraphModal.whenOutputNone.defaultDesc', { ns: 'workflow' }),
    },
  ]), [t])
  const selectedWhenOutputNoneOption = useMemo(() => (
    whenOutputNoneOptions.find(item => item.value === nestedNodeConfig.null_strategy) ?? whenOutputNoneOptions[0]
  ), [nestedNodeConfig.null_strategy, whenOutputNoneOptions])

  const handleNullStrategyChange = useCallback((value: NestedNodeConfig['null_strategy']) => {
    onNestedNodeConfigChange({
      ...nestedNodeConfig,
      null_strategy: value,
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
                <PortalToFollowElem
                  open={nullStrategyOpen}
                  onOpenChange={setNullStrategyOpen}
                  placement="bottom-end"
                  offset={4}
                >
                  <PortalToFollowElemTrigger onClick={(e) => {
                    e.stopPropagation()
                    e.nativeEvent.stopImmediatePropagation()
                    setNullStrategyOpen(v => !v)
                  }}
                  >
                    <Button size="small">
                      {selectedWhenOutputNoneOption?.label}
                      <RiArrowDownSLine className="h-3.5 w-3.5" />
                    </Button>
                  </PortalToFollowElemTrigger>
                  <PortalToFollowElemContent className="z-[70]">
                    <div className="w-[280px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-1 shadow-lg">
                      {whenOutputNoneOptions.map(option => (
                        <div
                          key={option.value}
                          className="flex cursor-pointer rounded-lg p-2 pr-3 hover:bg-state-base-hover"
                          onClick={(e) => {
                            e.stopPropagation()
                            e.nativeEvent.stopImmediatePropagation()
                            handleNullStrategyChange(option.value)
                            setNullStrategyOpen(false)
                          }}
                        >
                          <div className="mr-1 w-4 shrink-0">
                            {nestedNodeConfig.null_strategy === option.value && (
                              <RiCheckLine className="h-4 w-4 text-text-accent" />
                            )}
                          </div>
                          <div className="grow">
                            <div className="system-sm-semibold mb-0.5 text-text-secondary">{option.label}</div>
                            <div className="system-xs-regular text-text-tertiary">{option.description}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </PortalToFollowElemContent>
                </PortalToFollowElem>
              )}
            >
              <div className="space-y-2">
                {selectedWhenOutputNoneOption?.description && (
                  <div className="system-xs-regular text-text-tertiary">
                    {selectedWhenOutputNoneOption.description}
                  </div>
                )}
                {nestedNodeConfig.null_strategy === NULL_STRATEGY.USE_DEFAULT && (
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
