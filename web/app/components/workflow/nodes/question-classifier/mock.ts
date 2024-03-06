import { BlockEnum } from '../../types'
import type { QuestionClassifierNodeType } from './types'

export const mockData: QuestionClassifierNodeType = {
  title: 'Question Classifier',
  desc: 'Test',
  type: BlockEnum.QuestionClassifier,
  query_variable_selector: ['aaa', 'name'],
  model: {
    provider: 'openai',
    name: 'gpt-4',
    mode: 'chat',
    completion_params: {
      temperature: 0.7,
    },
  },
  classes: [
    {
      id: '1',
      name: 'topic 1',
    },
    {
      id: '2',
      name: 'topic 2',
    },
  ],
  instruction: 'You are an entity extraction model that accepts an input',
  memory: {
    window: {
      enabled: false,
      size: 0,
    },
  },
}
