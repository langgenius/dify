import { BlockEnum } from '../../../types'
import IfElseNode from '../../../workflow-preview/components/nodes/if-else/node'
import IterationNode from '../../../workflow-preview/components/nodes/iteration/node'
import LoopNode from '../../../workflow-preview/components/nodes/loop/node'
import QuestionClassifierNode from '../../../workflow-preview/components/nodes/question-classifier/node'

// todo: add human-input node support
export const NodeComponentMap: Record<string, any> = {
  [BlockEnum.QuestionClassifier]: QuestionClassifierNode,
  [BlockEnum.IfElse]: IfElseNode,
  [BlockEnum.Iteration]: IterationNode,
  [BlockEnum.Loop]: LoopNode,
}
