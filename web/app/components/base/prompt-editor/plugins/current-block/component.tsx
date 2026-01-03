import type { FC } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { useEffect } from 'react'
import { GeneratorType } from '@/app/components/app/configuration/config/automatic/types'
import { cn } from '@/utils/classnames'
import { CurrentBlockNode, DELETE_CURRENT_BLOCK_COMMAND } from '.'
import { CodeAssistant, MagicEdit } from '../../../icons/src/vender/line/general'
import { useSelectOrDelete } from '../../hooks'

type CurrentBlockComponentProps = {
  nodeKey: string
  generatorType: GeneratorType
}

const CurrentBlockComponent: FC<CurrentBlockComponentProps> = ({
  nodeKey,
  generatorType,
}) => {
  const [editor] = useLexicalComposerContext()
  const [ref, isSelected] = useSelectOrDelete(nodeKey, DELETE_CURRENT_BLOCK_COMMAND)

  const Icon = generatorType === GeneratorType.prompt ? MagicEdit : CodeAssistant
  useEffect(() => {
    if (!editor.hasNodes([CurrentBlockNode]))
      throw new Error('WorkflowVariableBlockPlugin: WorkflowVariableBlock not registered on editor')
  }, [editor])

  return (
    <div
      className={cn(
        'group/wrap relative mx-0.5 flex h-[18px] select-none items-center rounded-[5px] border pl-0.5 pr-[3px] text-util-colors-violet-violet-600 hover:border-state-accent-solid hover:bg-state-accent-hover',
        isSelected ? ' border-state-accent-solid bg-state-accent-hover' : ' border-components-panel-border-subtle bg-components-badge-white-to-dark',
      )}
      onClick={(e) => {
        e.stopPropagation()
      }}
      ref={ref}
    >
      <Icon className="mr-0.5 h-[14px] w-[14px]" />
      <div className="text-xs font-medium">{generatorType === GeneratorType.prompt ? 'current_prompt' : 'current_code'}</div>
    </div>
  )
}

export default CurrentBlockComponent
