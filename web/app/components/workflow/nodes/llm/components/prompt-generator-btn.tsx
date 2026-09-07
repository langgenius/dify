'use client'
import type { FC } from 'react'
import type { ModelConfig } from '@/app/components/workflow/types'
import type { GenRes } from '@/service/debug'
import { cn } from '@langgenius/dify-ui/cn'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import * as React from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import GetAutomaticResModal from '@/app/components/app/configuration/config/automatic/get-automatic-res'
import { Generator } from '@/app/components/base/icons/src/vender/other'
import { AppModeEnum } from '@/types/app'
import { useHooksStore } from '../../../hooks-store'

type Props = Readonly<{
  className?: string
  onGenerated?: (prompt: string) => void
  modelConfig?: ModelConfig
  nodeId: string
  editorId?: string
  currentPrompt?: string
}>

const PromptGeneratorBtn: FC<Props> = ({
  className,
  onGenerated,
  nodeId,
  editorId,
  currentPrompt,
}) => {
  const { t } = useTranslation()
  const [showAutomatic, setShowAutomatic] = useState(false)
  const handleAutomaticRes = useCallback(
    (res: GenRes) => {
      onGenerated?.(res.modified)
      setShowAutomatic(false)
    },
    [onGenerated],
  )
  const configsMap = useHooksStore((s) => s.configsMap)
  return (
    <div className={cn(className)}>
      <IconButton
        aria-label={t(($) => $['operation.automatic'], { ns: 'appDebug' })}
        className="hover:bg-[#155EFF]/8"
        onClick={() => setShowAutomatic(true)}
      >
        <Generator aria-hidden className="size-4 text-primary-600" />
      </IconButton>
      {showAutomatic && (
        <GetAutomaticResModal
          mode={AppModeEnum.CHAT}
          isShow={showAutomatic}
          onClose={() => setShowAutomatic(false)}
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
