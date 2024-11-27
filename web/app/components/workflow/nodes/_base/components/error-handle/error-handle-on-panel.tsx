import Collapse from '../collapse'
import { ErrorHandleTypeEnum } from './types'
import ErrorHandleTypeSelector from './error-handle-type-selector'
import FailBranchCard from './fail-branch-card'
import DefaultValue from './default-value'
import {
  useErrorHandle,
  useGetDefaultValueForms,
} from './hooks'
import type { Node } from '@/app/components/workflow/types'
import Split from '@/app/components/workflow/nodes/_base/components/split'

type ErrorHandleProps = Pick<Node, 'id' | 'data'>
const ErrorHandle = ({
  id,
  data,
}: ErrorHandleProps) => {
  const { error_strategy } = data
  const defaultValueForms = useGetDefaultValueForms({ id, data })
  const {
    collapsed,
    setCollapsed,
    handleErrorHandleTypeChange,
  } = useErrorHandle({ id, data })

  return (
    <>
      <Split />
      <div className='py-4'>
        <Collapse
          disabled={!error_strategy}
          collapsed={collapsed}
          onCollapse={setCollapsed}
          trigger={
            <div className='grow flex items-center justify-between pr-4'>
              <div className='system-sm-semibold-uppercase text-text-secondary'>ERROR HANDLING</div>
              <ErrorHandleTypeSelector
                value={error_strategy || ErrorHandleTypeEnum.none}
                onSelected={handleErrorHandleTypeChange}
              />
            </div>
          }
        >
          <>
            {
              error_strategy === ErrorHandleTypeEnum.failBranch && !collapsed && (
                <FailBranchCard />
              )
            }
            {
              error_strategy === ErrorHandleTypeEnum.defaultValue && !collapsed && (
                <DefaultValue forms={defaultValueForms} />
              )
            }
          </>
        </Collapse>
      </div>
    </>
  )
}

export default ErrorHandle
