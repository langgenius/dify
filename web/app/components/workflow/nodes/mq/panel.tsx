import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import useConfig from './use-config'
import type { MqNodeType } from './types'
import Editor from '@/app/components/workflow/nodes/_base/components/prompt/editor'
import type { NodePanelProps } from '@/app/components/workflow/types'
import useAvailableVarList from '@/app/components/workflow/nodes/_base/hooks/use-available-var-list'
import InputWithVar from '@/app/components/workflow/nodes/_base/components/prompt/editor'
const i18nPrefix = 'workflow.nodes.answer'

const Panel: FC<NodePanelProps<MqNodeType>> = ({
  id,
  data,
}) => {
  const { t } = useTranslation()

  const {
    readOnly,
    inputs,
    handleMessageChange,
    handleChannelNameChange,
    filterVar,
  } = useConfig(id, data)

  const { availableVars, availableNodesWithParent } = useAvailableVarList(id, {
    onlyLeafNodeVar: false,
    hideChatVar: false,
    hideEnv: false,
    filterVar,
  })

  return (
    <div className='mb-2 mt-2 space-y-4 px-4'>
      <Editor
        readOnly={readOnly}
        justVar
        title={'Channel'}
        value={inputs.channelName}
        onChange={handleChannelNameChange}
        nodesOutputVars={availableVars}
        availableNodes={availableNodesWithParent}
        isSupportFileVar
      />
      <div className='mt-1'></div>
      <InputWithVar
        title='数据'
        value={inputs.message}
        onChange={handleMessageChange}
        justVar
        nodesOutputVars={availableVars}
        availableNodes={availableNodesWithParent}
      />
    </div>
  )
}

export default React.memo(Panel)
