import type { FC } from 'react'
import { useSelectOrDelete } from '../../hooks'
import { DELETE_HITL_INPUT_BLOCK_COMMAND } from './'
import ComponentUi from './component-ui'

type QueryBlockComponentProps = {
  nodeKey: string
  nodeName: string
  varName: string
}

const HITLInputComponent: FC<QueryBlockComponentProps> = ({
  nodeKey,
  nodeName,
  varName,
}) => {
  const [ref, isSelected] = useSelectOrDelete(nodeKey, DELETE_HITL_INPUT_BLOCK_COMMAND)
  return (
    <div
      ref={ref}
      className='w-full pb-1 pt-3'
    >
      <ComponentUi
        nodeName={nodeName}
        varName={varName}
        isSelected={isSelected}
      />
    </div>
  )
}

export default HITLInputComponent
