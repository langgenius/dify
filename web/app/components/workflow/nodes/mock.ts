import { BlockEnum } from '@/app/components/workflow/types'

export const mockNodesData: Record<string, any> = {
  aaa: {
    title: 'Start',
    type: BlockEnum.Start,

  },
  bbb: {
    title: 'Knowledge',
    type: BlockEnum.KnowledgeRetrieval,
  },
}
