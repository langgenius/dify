import {
  useCallback,
  useState,
} from 'react'
import Collapse from '../collapse'
import { ErrorHandleTypeEnum } from './types'
import ErrorHandleTypeSelector from './error-handle-type-selector'
import FailBranchCard from './fail-branch-card'
import DefaultValue from './default-value'
import type { Node } from '@/app/components/workflow/types'
import {
  useNodeDataUpdate,
} from '@/app/components/workflow/hooks'
import Split from '@/app/components/workflow/nodes/_base/components/split'

type ErrorHandleProps = Pick<Node, 'id' | 'data'>
const ErrorHandle = ({
  id,
  data,
}: ErrorHandleProps) => {
  const { handleNodeDataUpdateWithSyncDraft } = useNodeDataUpdate()
  const { error_strategy } = data
  const [collapsed, setCollapsed] = useState(true)

  const handleErrorHandleTypeChange = useCallback((value: ErrorHandleTypeEnum) => {
    if (value === ErrorHandleTypeEnum.none) {
      handleNodeDataUpdateWithSyncDraft({
        id,
        data: {
          error_strategy: undefined,
        },
      })
      setCollapsed(true)
    }
    else {
      handleNodeDataUpdateWithSyncDraft({
        id,
        data: {
          error_strategy: value,
        },
      })
      setCollapsed(false)
    }
  }, [id, handleNodeDataUpdateWithSyncDraft])

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
                <DefaultValue />
              )
            }
          </>
        </Collapse>
      </div>
    </>
  )
}

export default ErrorHandle
