import { BlockEnum } from '../../types'
import type { DirectAnswerNodeType } from './types'

export const mockData: DirectAnswerNodeType = {
  title: 'Test',
  desc: 'Test',
  type: BlockEnum.DirectAnswer,
  variables: [
    {
      variable: 'age',
      value_selector: ['bbb', 'b', 'c'],
    },
  ],
  answer: 'Sorry, I cannot answer this question.',
}
