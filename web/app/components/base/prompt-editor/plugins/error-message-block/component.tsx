import { type FC, useEffect } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { useSelectOrDelete } from '../../hooks'
import { DELETE_ERROR_MESSAGE_COMMAND, ErrorMessageBlockNode } from '.'
import cn from '@/utils/classnames'
import { Variable02 } from '../../../icons/src/vender/solid/development'

type Props = {
  nodeKey: string
}

const ErrorMessageBlockComponent: FC<Props> = ({
  nodeKey,
}) => {
  const [editor] = useLexicalComposerContext()
  const [ref, isSelected] = useSelectOrDelete(nodeKey, DELETE_ERROR_MESSAGE_COMMAND)

  useEffect(() => {
    if (!editor.hasNodes([ErrorMessageBlockNode]))
      throw new Error('WorkflowVariableBlockPlugin: WorkflowVariableBlock not registered on editor')
  }, [editor])

  return (
    <div
      className={cn(
        'group/wrap relative mx-0.5 flex h-[18px] select-none items-center rounded-[5px] border pl-0.5 pr-[3px] text-util-colors-orange-dark-orange-dark-600 hover:border-state-accent-solid hover:bg-state-accent-hover',
        isSelected ? ' border-state-accent-solid bg-state-accent-hover' : ' border-components-panel-border-subtle bg-components-badge-white-to-dark',
      )}
      onClick={(e) => {
        e.stopPropagation()
      }}
      ref={ref}
    >
      <Variable02 className='mr-0.5 h-[14px] w-[14px]' />
      <div className='text-xs font-medium'>error_message</div>
    </div>
  )
}

export default ErrorMessageBlockComponent
