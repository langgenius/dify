'use client'

import type { FC } from 'react'
import type { ModelConfig } from '@/app/components/workflow/types'
import type { GenRes } from '@/service/debug'
import { cn } from '@langgenius/dify-ui/cn'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { useAtomValue } from 'jotai'
import * as React from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import GetAutomaticResModal from '@/app/components/app/configuration/config/automatic/get-automatic-res'
import { getEditorResourceId } from '@/app/components/workflow/editor-resource/resource'
import { editorResourceAtom } from '@/app/components/workflow/editor-resource/state'

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
  const { t } = useTranslation(['appDebug'])
  const [showAutomatic, setShowAutomatic] = useState(false)
  const handleAutomaticRes = useCallback(
    (res: GenRes) => {
      onGenerated?.(res.modified)
      setShowAutomatic(false)
    },
    [onGenerated],
  )
  const resource = useAtomValue(editorResourceAtom)
  const resourceId = getEditorResourceId(resource)
  return (
    <div className={cn(className)}>
      <IconButton
        aria-label={t(($) => $['operation.automatic'], { ns: 'appDebug' })}
        className="hover:bg-[#155EFF]/8"
        onClick={() => setShowAutomatic(true)}
      >
        <span aria-hidden className="i-custom-vender-other-generator size-4 text-primary-600" />
      </IconButton>
      {showAutomatic && (
        <GetAutomaticResModal
          modelMode="chat"
          isShow={showAutomatic}
          onClose={() => setShowAutomatic(false)}
          onFinished={handleAutomaticRes}
          flowId={resourceId || ''}
          nodeId={nodeId}
          editorId={editorId}
          currentPrompt={currentPrompt}
        />
      )}
    </div>
  )
}

export default React.memo(PromptGeneratorBtn)
