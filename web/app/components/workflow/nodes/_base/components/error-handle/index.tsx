import { useState } from 'react'
import { errorHandleTypeEnum } from './types'
import ErrorHandleTypeSelector from './error-handle-type-selector'
import FailBranchCard from './fail-branch-card'
import DefaultValue from './default-value'

const ErrorHandle = () => {
  const [errorHandleType, setErrorHandleType] = useState(errorHandleTypeEnum.none)

  return (
    <div>
      <div className='flex justify-between items-center pt-2 pr-4'>
        <div className='flex items-center'>
          <div className='system-sm-semibold-uppercase text-text-secondary'>ERROR HANDLING</div>
        </div>
        <ErrorHandleTypeSelector
          value={errorHandleType}
          onSelected={setErrorHandleType}
        />
      </div>
      {
        errorHandleType === errorHandleTypeEnum.failBranch && (
          <FailBranchCard />
        )
      }
      {
        errorHandleType === errorHandleTypeEnum.defaultValue && (
          <DefaultValue />
        )
      }
    </div>
  )
}

export default ErrorHandle
