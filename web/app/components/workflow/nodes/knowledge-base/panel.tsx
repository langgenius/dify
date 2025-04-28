import type { FC } from 'react'
import { memo } from 'react'
import type { KnowledgeBaseNodeType } from './types'
import InputVariable from './components/input-variable'
import ChunkStructure from './components/chunk-structure'
import IndexMethod from './components/index-method'
import RetrievalSetting from './components/retrieval-setting'
import EmbeddingModel from './components/embedding-model'
import type { NodePanelProps } from '@/app/components/workflow/types'
import {
  Group,
  GroupWithBox,
} from '@/app/components/workflow/nodes/_base/components/layout'
import Split from '../_base/components/split'

const Panel: FC<NodePanelProps<KnowledgeBaseNodeType>> = () => {
  return (
    <div>
      <GroupWithBox boxProps={{ withBorderBottom: true }}>
        <InputVariable />
      </GroupWithBox>
      <Group
        className='py-3'
        withBorderBottom
      >
        <ChunkStructure />
      </Group>
      <GroupWithBox>
        <div className='space-y-3'>
          <IndexMethod />
          <EmbeddingModel />
          <div className='pt-1'>
            <Split className='h-[1px]' />
          </div>
          <RetrievalSetting />
        </div>
      </GroupWithBox>
    </div>
  )
}

export default memo(Panel)
