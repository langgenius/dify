import type { FC } from 'react'
import React from 'react'
import RemoveButton from '../_base/components/remove-button'
import type { CodeDependency } from './types'
import DependencyPicker from './dependency-picker'

type Props = {
  available_dependencies: CodeDependency[]
  dependencies: CodeDependency[]
  handleRemove: (index: number) => void
  handleChange: (index: number, dependency: CodeDependency) => void
}

const Dependencies: FC<Props> = ({
  available_dependencies, dependencies, handleRemove, handleChange,
}) => {
  return (
    <div className='space-y-2'>
      {dependencies.map((dependency, index) => (
        <div className='flex items-center space-x-1' key={index}>
          <DependencyPicker
            value={dependency}
            available_dependencies={available_dependencies}
            onChange={dependency => handleChange(index, dependency)}
          />
          <RemoveButton
            className='!p-2 !bg-gray-100 hover:!bg-gray-200'
            onClick={() => handleRemove(index)}
          />
        </div>
      ))}
    </div>
  )
}

export default React.memo(Dependencies)
