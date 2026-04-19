import type { FC } from 'react'
import type { LLMNodeType } from '../types'
import type { Memory, Node, NodeOutPutVar } from '@/app/components/workflow/types'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
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
              <Popover>
                <PopoverTrigger
                  openOnHover
                  nativeButton={false}
                  aria-label={t('nodes.common.memories.tip', { ns: 'workflow' })}
                  render={(
                    <span className="ml-1 flex h-4 w-4 shrink-0 items-center justify-center">
                      <span aria-hidden className="i-ri-question-line h-3.5 w-3.5 text-text-quaternary hover:text-text-tertiary" />
                    </span>
                  )}
                />
                <PopoverContent
                  placement="top"
                  popupClassName="max-w-[300px] rounded-md border-0 bg-components-panel-bg px-3 py-2 text-left system-xs-regular wrap-break-word text-text-tertiary shadow-lg"
                >
                  {t('nodes.common.memories.tip', { ns: 'workflow' })}
                </PopoverContent>
              </Popover>
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
                  <Popover>
                    <PopoverTrigger
                      openOnHover
                      nativeButton={false}
                      aria-label={t('nodes.llm.roleDescription.user', { ns: 'workflow' })}
                      render={(
                        <span className="ml-1 flex h-4 w-4 shrink-0 items-center justify-center">
                          <span aria-hidden className="i-ri-question-line h-3.5 w-3.5 text-text-quaternary hover:text-text-tertiary" />
                        </span>
                      )}
                    />
                    <PopoverContent
                      placement="top"
                      popupClassName="max-w-[300px] rounded-md border-0 bg-components-panel-bg px-3 py-2 text-left system-xs-regular wrap-break-word text-text-tertiary shadow-lg"
                    >
                      <div className="max-w-[180px]">{t('nodes.llm.roleDescription.user', { ns: 'workflow' })}</div>
                    </PopoverContent>
                  </Popover>
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
