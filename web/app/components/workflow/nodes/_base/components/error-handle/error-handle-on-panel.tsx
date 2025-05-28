import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import Collapse from '../collapse'
import { ErrorHandleTypeEnum } from './types'
import ErrorHandleTypeSelector from './error-handle-type-selector'
import FailBranchCard from './fail-branch-card'
import DefaultValue from './default-value'
import {
  useDefaultValue,
  useErrorHandle,
} from './hooks'
import type { DefaultValueForm } from './types'
import type {
  CommonNodeType,
  Node,
} from '@/app/components/workflow/types'
import Tooltip from '@/app/components/base/tooltip'

type ErrorHandleProps = Pick<Node, 'id' | 'data'>
const ErrorHandle = ({
  id,
  data,
}: ErrorHandleProps) => {
  const { t } = useTranslation()
  const { error_strategy, default_value } = data
  const {
    collapsed,
    setCollapsed,
    handleErrorHandleTypeChange,
  } = useErrorHandle(id, data)
  const { handleFormChange } = useDefaultValue(id)

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
      <div className='py-4'>
        <Collapse
          disabled={!error_strategy}
          collapsed={collapsed}
          onCollapse={setCollapsed}
          hideCollapseIcon
          trigger={
            collapseIcon => (
              <div className='flex grow items-center justify-between pr-4'>
                <div className='flex items-center'>
                  <div className='system-sm-semibold-uppercase mr-0.5 text-text-secondary'>
                    {t('workflow.nodes.common.errorHandle.title')}
                  </div>
                  <Tooltip popupContent={t('workflow.nodes.common.errorHandle.tip')} />
                  {collapseIcon}
                </div>
                <ErrorHandleTypeSelector
                  value={error_strategy || ErrorHandleTypeEnum.none}
                  onSelected={getHandleErrorHandleTypeChange(data)}
                />
              </div>
            )}
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
          </>
        </Collapse>
      </div>
    </>
  )
}

export default ErrorHandle
