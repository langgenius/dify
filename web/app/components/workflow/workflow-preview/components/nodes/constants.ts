import { BlockEnum } from '@/app/components/workflow/types'
import HumanInputNode from './human-input/node'
import IfElseNode from './if-else/node'
import IterationNode from './iteration/node'
import LoopNode from './loop/node'
import QuestionClassifierNode from './question-classifier/node'

export const NodeComponentMap: Record<string, any> = {
  [BlockEnum.QuestionClassifier]: QuestionClassifierNode,
  [BlockEnum.IfElse]: IfElseNode,
  [BlockEnum.HumanInput]: HumanInputNode,
  [BlockEnum.Iteration]: IterationNode,
  [BlockEnum.Loop]: LoopNode,
}
