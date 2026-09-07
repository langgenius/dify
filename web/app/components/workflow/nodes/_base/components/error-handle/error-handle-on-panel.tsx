import type { DefaultValueForm } from './types'
import type { CommonNodeType, Node } from '@/app/components/workflow/types'
import { useTranslation } from 'react-i18next'
import { Infotip } from '@/app/components/base/infotip'
import {
  Collapse,
  CollapseActions,
  CollapseContent,
  CollapseHeader,
  CollapseIndicator,
  CollapseTitle,
  CollapseTrigger,
} from '../collapse'
import DefaultValue from './default-value'
import ErrorHandleTypeSelector from './error-handle-type-selector'
import FailBranchCard from './fail-branch-card'
import { useDefaultValue, useErrorHandle } from './hooks'
import { ErrorHandleTypeEnum } from './types'

type ErrorHandleProps = Pick<Node, 'id' | 'data'>

const ErrorHandle = ({ id, data }: ErrorHandleProps) => {
  const { t } = useTranslation()
  const { error_strategy, default_value } = data
  const { collapsed, setCollapsed, handleErrorHandleTypeChange } = useErrorHandle(id, data)
  const { handleFormChange } = useDefaultValue(id)

  const handleTypeChange = (value: ErrorHandleTypeEnum) => {
    handleErrorHandleTypeChange(value, data as CommonNodeType)
  }

  const handleDefaultValueChange = (value: DefaultValueForm) => {
    handleFormChange(value, data as CommonNodeType)
  }

  return (
    <div className="py-4">
      <Collapse disabled={!error_strategy} collapsed={collapsed} onCollapse={setCollapsed}>
        <CollapseHeader>
          <CollapseTrigger>
            <CollapseTitle>
              {t(($) => $['nodes.common.errorHandle.title'], { ns: 'workflow' })}
            </CollapseTitle>
            {!!error_strategy && <CollapseIndicator />}
          </CollapseTrigger>
          <Infotip aria-label={t(($) => $['nodes.common.errorHandle.tip'], { ns: 'workflow' })}>
            {t(($) => $['nodes.common.errorHandle.tip'], { ns: 'workflow' })}
          </Infotip>
          <CollapseActions>
            <div className="pr-4">
              <ErrorHandleTypeSelector
                value={error_strategy || ErrorHandleTypeEnum.none}
                onSelected={handleTypeChange}
              />
            </div>
          </CollapseActions>
        </CollapseHeader>
        <CollapseContent>
          {error_strategy === ErrorHandleTypeEnum.failBranch && !collapsed && <FailBranchCard />}
          {error_strategy === ErrorHandleTypeEnum.defaultValue &&
            !collapsed &&
            !!default_value?.length && (
              <DefaultValue forms={default_value} onFormChange={handleDefaultValueChange} />
            )}
        </CollapseContent>
      </Collapse>
    </div>
  )
}

export default ErrorHandle
