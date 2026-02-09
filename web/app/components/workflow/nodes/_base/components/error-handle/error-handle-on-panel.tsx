import type { DefaultValueForm } from './types'
import type { LLMNodeType } from '@/app/components/workflow/nodes/llm/types'
import type {
  CommonNodeType,
  ModelConfig,
  Node,
} from '@/app/components/workflow/types'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import Tooltip from '@/app/components/base/tooltip'
import { useNodeDataUpdate } from '@/app/components/workflow/hooks'
import { BlockEnum } from '@/app/components/workflow/types'
import Collapse from '../collapse'
import DefaultValue from './default-value'
import ErrorHandleTypeSelector from './error-handle-type-selector'
import FailBranchCard from './fail-branch-card'
import FallbackModelSelector from './fallback-model-selector'
import {
  useDefaultValue,
  useErrorHandle,
} from './hooks'
import { ErrorHandleTypeEnum } from './types'

type ErrorHandleProps = Pick<Node, 'id' | 'data'>
const ErrorHandle = ({
  id,
  data,
}: ErrorHandleProps) => {
  const { t } = useTranslation()
  const { error_strategy, default_value, type } = data
  const {
    collapsed,
    setCollapsed,
    handleErrorHandleTypeChange,
  } = useErrorHandle(id, data)
  const { handleFormChange } = useDefaultValue(id)
  const { handleNodeDataUpdateWithSyncDraft } = useNodeDataUpdate()

  const handleFallbackModelsChange = useCallback((models: ModelConfig[]) => {
    handleNodeDataUpdateWithSyncDraft({
      id,
      data: {
        fallback_models: models,
      },
    })
  }, [id, handleNodeDataUpdateWithSyncDraft])

  const getHandleErrorHandleTypeChange = useCallback((data: CommonNodeType) => {
    return (value: ErrorHandleTypeEnum) => {
      handleErrorHandleTypeChange(value, data)
    }
  }, [handleErrorHandleTypeChange])

  const getHandleFormChange = useCallback((data: CommonNodeType) => {
    return (v: DefaultValueForm) => {
      handleFormChange(v, data)
    }
  }, [handleFormChange])

  return (
    <>
      <div className="py-4">
        <Collapse
          disabled={!error_strategy}
          collapsed={collapsed}
          onCollapse={setCollapsed}
          hideCollapseIcon
          trigger={
            collapseIcon => (
              <div className="flex grow items-center justify-between pr-4">
                <div className="flex items-center">
                  <div className="system-sm-semibold-uppercase mr-0.5 text-text-secondary">
                    {t('nodes.common.errorHandle.title', { ns: 'workflow' })}
                  </div>
                  <Tooltip popupContent={t('nodes.common.errorHandle.tip', { ns: 'workflow' })} />
                  {collapseIcon}
                </div>
                <ErrorHandleTypeSelector
                  value={error_strategy || ErrorHandleTypeEnum.none}
                  onSelected={getHandleErrorHandleTypeChange(data)}
                  nodeType={type}
                />
              </div>
            )
          }
        >
          <>
            {
              error_strategy === ErrorHandleTypeEnum.failBranch && !collapsed && (
                <FailBranchCard />
              )
            }
            {
              error_strategy === ErrorHandleTypeEnum.defaultValue && !collapsed && !!default_value?.length && (
                <DefaultValue
                  forms={default_value}
                  onFormChange={getHandleFormChange(data)}
                />
              )
            }
            {
              error_strategy === ErrorHandleTypeEnum.fallbackModel && !collapsed && type === BlockEnum.LLM && (
                <FallbackModelSelector
                  models={(data as LLMNodeType).fallback_models || []}
                  primaryModel={(data as LLMNodeType).model}
                  onChange={handleFallbackModelsChange}
                  readonly={false}
                />
              )
            }
          </>
        </Collapse>
      </div>
    </>
  )
}

export default ErrorHandle
