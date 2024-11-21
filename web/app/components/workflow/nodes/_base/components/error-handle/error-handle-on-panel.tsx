import {
  useCallback,
  useState,
} from 'react'
import { RiArrowDropRightLine } from '@remixicon/react'
import { ErrorHandleTypeEnum } from './types'
import ErrorHandleTypeSelector from './error-handle-type-selector'
import FailBranchCard from './fail-branch-card'
import DefaultValue from './default-value'
import cn from '@/utils/classnames'
import type { Node } from '@/app/components/workflow/types'
import {
  useNodeDataUpdate,
} from '@/app/components/workflow/hooks'

type ErrorHandleProps = Pick<Node, 'id' | 'data'>
const ErrorHandle = ({
  id,
  data,
}: ErrorHandleProps) => {
  const { handleNodeDataUpdateWithSyncDraft } = useNodeDataUpdate()
  const { error_strategy } = data
  const [collapsed, setCollapsed] = useState(true)
  const [errorHandleType, setErrorHandleType] = useState(ErrorHandleTypeEnum.none)

  const handleErrorHandleTypeChange = useCallback((value: ErrorHandleTypeEnum) => {
    setErrorHandleType(value)
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
    <div>
      <div
        className='flex justify-between items-center pt-2 pr-4'
        onClick={() => {
          if (error_strategy)
            setCollapsed(!collapsed)
        }}
      >
        <div className='flex items-center'>
          <div className='w-4 h-4'>
            {
              error_strategy && (
                <RiArrowDropRightLine
                  className={cn(
                    'w-4 h-4 text-text-tertiary',
                    !collapsed && 'transform rotate-90',
                  )}
                />
              )
            }
          </div>
          <div className='system-sm-semibold-uppercase text-text-secondary'>ERROR HANDLING</div>
        </div>
        <ErrorHandleTypeSelector
          value={errorHandleType}
          onSelected={handleErrorHandleTypeChange}
        />
      </div>
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
    </div>
  )
}

export default ErrorHandle
