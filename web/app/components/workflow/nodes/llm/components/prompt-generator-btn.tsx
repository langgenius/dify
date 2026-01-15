'use client'
import type { FC } from 'react'
import type { ModelConfig } from '@/app/components/workflow/types'
import type { GenRes } from '@/service/debug'
import { useBoolean } from 'ahooks'
import * as React from 'react'
import { useCallback } from 'react'
import GetAutomaticResModal from '@/app/components/app/configuration/config/automatic/get-automatic-res'
import { ActionButton } from '@/app/components/base/action-button'
import { Generator } from '@/app/components/base/icons/src/vender/other'
import { AppModeEnum } from '@/types/app'
import { cn } from '@/utils/classnames'
import { useHooksStore } from '../../../hooks-store'

type Props = {
  className?: string
  onGenerated?: (prompt: string) => void
  modelConfig?: ModelConfig
  nodeId: string
  editorId?: string
  currentPrompt?: string
}

const PromptGeneratorBtn: FC<Props> = ({
  className,
  onGenerated,
  nodeId,
  editorId,
  currentPrompt,
}) => {
  const [showAutomatic, { setTrue: showAutomaticTrue, setFalse: showAutomaticFalse }] = useBoolean(false)
  const handleAutomaticRes = useCallback((res: GenRes) => {
    onGenerated?.(res.modified)
    showAutomaticFalse()
  }, [onGenerated, showAutomaticFalse])
  const configsMap = useHooksStore(s => s.configsMap)
  return (
    <div className={cn(className)}>
      <ActionButton
        className="hover:bg-[#155EFF]/8"
        onClick={showAutomaticTrue}
      >
        <Generator className="h-4 w-4 text-primary-600" />
      </ActionButton>
      {showAutomatic && (
        <GetAutomaticResModal
          mode={AppModeEnum.CHAT}
          isShow={showAutomatic}
          onClose={showAutomaticFalse}
          onFinished={handleAutomaticRes}
          flowId={configsMap?.flowId || ''}
          nodeId={nodeId}
          editorId={editorId}
          currentPrompt={currentPrompt}
        />
      )}
    </div>
  )
}

export default React.memo(PromptGeneratorBtn)
