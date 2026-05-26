import { BlockEnum } from '@/app/components/workflow/types'
import IfElseNode from '@/app/components/workflow/workflow-preview/components/nodes/if-else/node'
import IterationNode from '@/app/components/workflow/workflow-preview/components/nodes/iteration/node'
import LoopNode from '@/app/components/workflow/workflow-preview/components/nodes/loop/node'
import QuestionClassifierNode from '@/app/components/workflow/workflow-preview/components/nodes/question-classifier/node'

// todo: add human-input node support
export const NodeComponentMap: Record<string, any> = {
  [BlockEnum.QuestionClassifier]: QuestionClassifierNode,
  [BlockEnum.IfElse]: IfElseNode,
  [BlockEnum.Iteration]: IterationNode,
  [BlockEnum.Loop]: LoopNode,
}
