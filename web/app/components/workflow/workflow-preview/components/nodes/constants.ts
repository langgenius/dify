import { BlockEnum } from '@/app/components/workflow/types'
import QuestionClassifierNode from './question-classifier/node'
import IfElseNode from './if-else/node'
import IterationNode from './iteration/node'
import LoopNode from './loop/node'

export const NodeComponentMap: Record<string, any> = {
  [BlockEnum.QuestionClassifier]: QuestionClassifierNode,
  [BlockEnum.IfElse]: IfElseNode,
  [BlockEnum.Iteration]: IterationNode,
  [BlockEnum.Loop]: LoopNode,
}
