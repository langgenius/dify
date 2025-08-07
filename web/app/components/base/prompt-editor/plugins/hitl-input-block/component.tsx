import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { useSelectOrDelete } from '../../hooks'
import { DELETE_HITL_INPUT_BLOCK_COMMAND } from './'
import { UserEdit02 } from '@/app/components/base/icons/src/vender/solid/users'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'

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
  const { t } = useTranslation()
  const [ref, isSelected] = useSelectOrDelete(nodeKey, DELETE_HITL_INPUT_BLOCK_COMMAND)
  const [editor] = useLexicalComposerContext()
  return (
    <div
      className={`
        flex h-6 w-full items-center rounded-[5px] border-[1.5px] border-components-input-border-active bg-background-default-hover pl-1 pr-0.5 hover:bg-[#FFEAD5]
        ${isSelected && '!border-[#FD853A]'}
      `}
      // draggable
      // onDragStart={(e) => {
      //   e.dataTransfer.setData('application/x-lexical-drag', nodeKey)
      //   e.dataTransfer.effectAllowed = 'move'
      //   console.log(`dragging node with key: ${nodeKey}`)
      // }}
      // onDragOver={(e) => {
      //   e.preventDefault()
      //   e.dataTransfer.dropEffect = 'move'
      // }}
      // onDragEnter={(e) => {
      //   e.preventDefault()
      //   e.currentTarget.classList.add('bg-[#FFEAD5]')
      // }}
      // onDragLeave={(e) => {
      //   e.currentTarget.classList.remove('bg-[#FFEAD5]')
      // }}
      // onDrop={(e) => {
      //   e.preventDefault()
      //   e.currentTarget.classList.remove('bg-[#FFEAD5]')

      //   const draggedNodeKey = e.dataTransfer.getData('application/x-lexical-drag')
      //   console.log('Drop event triggered with key:', draggedNodeKey)

      //   if (draggedNodeKey) {
      //     editor.update(() => {
      //       const draggedNode = $getNodeByKey(draggedNodeKey)
      //       const dropTarget = $getNodeByKey(nodeKey)

      //       if (draggedNode && dropTarget && draggedNode !== dropTarget) {
      //         console.log('Moving node in editor')
      //         dropTarget.insertAfter(draggedNode)
      //       }
      //     })
      //   }
      // }}
      ref={ref}
    >
      <UserEdit02 className='mr-1 h-[14px] w-[14px] text-[#FD853A]' />
      {nodeName}/{varName}
    </div>
  )
}

export default HITLInputComponent
