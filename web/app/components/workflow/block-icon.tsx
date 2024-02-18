import type { FC } from 'react'
import { memo } from 'react'
import { BlockEnum } from './types'
import {
  Code,
  DirectAnswer,
  End,
  Home,
  Http,
  IfElse,
  KnowledgeRetrieval,
  Llm,
  QuestionClassifier,
  TemplatingTransform,
  VariableX,
} from '@/app/components/base/icons/src/public/workflow'

type BlockIconProps = {
  type: BlockEnum
  size?: string
  className?: string
}
const ICON_CONTAINER_CLASSNAME_SIZE_MAP: Record<string, string> = {
  sm: 'w-5 h-5 rounded-md shadow-xs',
  md: 'w-6 h-6 rounded-lg shadow-md',
}
const ICON_MAP: Record<string, any> = {
  [BlockEnum.Start]: <Home className='w-3.5 h-3.5' />,
  [BlockEnum.LLM]: <Llm className='w-3.5 h-3.5' />,
  [BlockEnum.Code]: <Code className='w-3.5 h-3.5' />,
  [BlockEnum.End]: <End className='w-3.5 h-3.5' />,
  [BlockEnum.IfElse]: <IfElse className='w-3.5 h-3.5' />,
  [BlockEnum.HttpRequest]: <Http className='w-3.5 h-3.5' />,
  [BlockEnum.DirectAnswer]: <DirectAnswer className='w-3.5 h-3.5' />,
  [BlockEnum.KnowledgeRetrieval]: <KnowledgeRetrieval className='w-3.5 h-3.5' />,
  [BlockEnum.QuestionClassifier]: <QuestionClassifier className='w-3.5 h-3.5' />,
  [BlockEnum.TemplateTransform]: <TemplatingTransform className='w-3.5 h-3.5' />,
  [BlockEnum.VariableAssigner]: <VariableX className='w-3.5 h-3.5' />,
}
const ICON_CONTAINER_BG_COLOR_MAP: Record<string, string> = {
  [BlockEnum.Start]: 'bg-primary-500',
  [BlockEnum.LLM]: 'bg-[#6172F3]',
  [BlockEnum.Code]: 'bg-[#2E90FA]',
  [BlockEnum.End]: 'bg-[#F79009]',
  [BlockEnum.IfElse]: 'bg-[#06AED4]',
  [BlockEnum.HttpRequest]: 'bg-[#875BF7]',
  [BlockEnum.DirectAnswer]: 'bg-[#F79009]',
  [BlockEnum.KnowledgeRetrieval]: 'bg-[#16B364]',
  [BlockEnum.QuestionClassifier]: 'bg-[#16B364]',
  [BlockEnum.TemplateTransform]: 'bg-[#2E90FA]',
  [BlockEnum.VariableAssigner]: 'bg-[#2E90FA]',
}
const BlockIcon: FC<BlockIconProps> = ({
  type,
  size = 'sm',
  className,
}) => {
  return (
    <div className={`
      flex items-center justify-center border-[0.5px] border-white/[0.02]
      ${ICON_CONTAINER_CLASSNAME_SIZE_MAP[size]} 
      ${ICON_CONTAINER_BG_COLOR_MAP[type]}
      ${className}
    `}
    >
      {ICON_MAP[type]}
    </div>
  )
}

export default memo(BlockIcon)
