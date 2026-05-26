import type { DefaultValueForm } from '@/app/components/workflow/nodes/_base/components/error-handle/types'
import type {
  CommonNodeType,
  Node,
} from '@/app/components/workflow/types'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Infotip } from '@/app/components/base/infotip'
import Collapse from '@/app/components/workflow/nodes/_base/components/collapse/index'
import DefaultValue from '@/app/components/workflow/nodes/_base/components/error-handle/default-value'
import ErrorHandleTypeSelector from '@/app/components/workflow/nodes/_base/components/error-handle/error-handle-type-selector'
import FailBranchCard from '@/app/components/workflow/nodes/_base/components/error-handle/fail-branch-card'
import {
  useDefaultValue,
  useErrorHandle,
} from '@/app/components/workflow/nodes/_base/components/error-handle/hooks'
import { ErrorHandleTypeEnum } from '@/app/components/workflow/nodes/_base/components/error-handle/types'

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
                  <div className="mr-0.5 system-sm-semibold-uppercase text-text-secondary">
                    {t('nodes.common.errorHandle.title', { ns: 'workflow' })}
                  </div>
                  <Infotip aria-label={t('nodes.common.errorHandle.tip', { ns: 'workflow' })}>
                    {t('nodes.common.errorHandle.tip', { ns: 'workflow' })}
                  </Infotip>
                  {collapseIcon}
                </div>
                <ErrorHandleTypeSelector
                  value={error_strategy || ErrorHandleTypeEnum.none}
                  onSelected={getHandleErrorHandleTypeChange(data)}
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
          </>
        </Collapse>
      </div>
    </>
  )
}

export default ErrorHandle
