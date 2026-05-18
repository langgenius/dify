import type { FC } from 'react'
import type { LLMNodeType } from '../types'
import type { Memory, Node, NodeOutPutVar } from '@/app/components/workflow/types'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Infotip } from '@/app/components/base/infotip'
import MemoryConfig from '@/app/components/workflow/nodes/_base/components/memory-config'
import Editor from '@/app/components/workflow/nodes/_base/components/prompt/editor'

type Props = {
  readOnly: boolean
  isChatMode: boolean
  isChatModel: boolean
  isCompletionModel: boolean
  inputs: LLMNodeType
  hasSetBlockStatus: {
    history: boolean
    query: boolean
    context: boolean
  }
  availableVars: NodeOutPutVar[]
  availableNodesWithParent: Node[]
  handleSyeQueryChange: (query: string) => void
  handleMemoryChange: (memory?: Memory) => void
}

const i18nPrefix = 'nodes.llm'

const PanelMemorySection: FC<Props> = ({
  readOnly,
  isChatMode,
  isChatModel,
  isCompletionModel,
  inputs,
  hasSetBlockStatus,
  availableVars,
  availableNodesWithParent,
  handleSyeQueryChange,
  handleMemoryChange,
}) => {
  const { t } = useTranslation()

  if (!isChatMode)
    return null

  return (
    <>
      {isChatModel && !!inputs.memory && (
        <div className="mt-4">
          <div className="flex h-8 items-center justify-between rounded-lg bg-components-input-bg-normal pr-2 pl-3">
            <div className="flex items-center space-x-1">
              <div className="text-xs font-semibold text-text-secondary uppercase">{t('nodes.common.memories.title', { ns: 'workflow' })}</div>
              <Infotip aria-label={t('nodes.common.memories.tip', { ns: 'workflow' })}>
                {t('nodes.common.memories.tip', { ns: 'workflow' })}
              </Infotip>
            </div>
            <div className="flex h-[18px] items-center rounded-[5px] border border-divider-deep bg-components-badge-bg-dimm px-1 text-xs font-semibold text-text-tertiary uppercase">
              {t('nodes.common.memories.builtIn', { ns: 'workflow' })}
            </div>
          </div>
          <div className="mt-4">
            <Editor
              title={(
                <div className="flex items-center space-x-1">
                  <div className="text-xs font-semibold text-text-secondary uppercase">user</div>
                  <Infotip
                    aria-label={t('nodes.llm.roleDescription.user', { ns: 'workflow' })}
                    popupClassName="w-[180px]"
                  >
                    {t('nodes.llm.roleDescription.user', { ns: 'workflow' })}
                  </Infotip>
                </div>
              )}
              value={inputs.memory.query_prompt_template || '{{#sys.query#}}'}
              onChange={handleSyeQueryChange}
              readOnly={readOnly}
              isShowContext={false}
              isChatApp
              isChatModel
              hasSetBlockStatus={hasSetBlockStatus}
              nodesOutputVars={availableVars}
              availableNodes={availableNodesWithParent}
              isSupportFileVar
            />

            {inputs.memory.query_prompt_template && !inputs.memory.query_prompt_template.includes('{{#sys.query#}}') && (
              <div className="text-xs leading-[18px] font-normal text-[#DC6803]">
                {t(`${i18nPrefix}.sysQueryInUser`, { ns: 'workflow' })}
              </div>
            )}
          </div>
        </div>
      )}

      <MemoryConfig
        readonly={readOnly}
        config={{ data: inputs.memory }}
        onChange={handleMemoryChange}
        canSetRoleName={isCompletionModel}
      />
    </>
  )
}

export default React.memo(PanelMemorySection)
