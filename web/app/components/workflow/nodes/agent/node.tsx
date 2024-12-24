import type { FC } from 'react'
import type { NodeProps } from '../../types'
import type { AgentNodeType } from './types'
import { SettingItem } from '../_base/components/setting-item'
import ModelSelector from '@/app/components/header/account-setting/model-provider-page/model-selector'
import { Group, GroupLabel } from '../_base/components/group'
import { ToolIcon } from './components/tool-icon'

const AgentNode: FC<NodeProps<AgentNodeType>> = (props) => {
  const strategySelected = true
  return <div className='mb-1 px-3 py-1 space-y-1'>
    {strategySelected
      // TODO: add tooltip for this
      ? <SettingItem label='Strategy' indicator='red'>
        ReAct
      </SettingItem>
      : <SettingItem label='Agentic strategy Not Set' />}
    <Group label={
      <GroupLabel className='mt-1'>
        Model
      </GroupLabel>}>
      <ModelSelector
        modelList={[]}
        readonly
      />
      <ModelSelector
        modelList={[]}
        readonly
      />
      <ModelSelector
        modelList={[]}
        readonly
      />
    </Group>
    <Group label={<GroupLabel className='mt-1'>
      Toolbox
    </GroupLabel>}>
      <div className='grid grid-cols-10 gap-0.5'>
        <ToolIcon src='/logo/logo.png' />
        <ToolIcon src='/logo/logo.png' status='error' tooltip='Gmail Sender is not installed' />
        <ToolIcon src='/logo/logo.png' status='warning' tooltip='DuckDuckGo AI Search Not Authorized' />
      </div>
    </Group>
  </div>
}

export default AgentNode
