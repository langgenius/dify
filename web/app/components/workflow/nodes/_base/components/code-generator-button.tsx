'use client'

import type { FC } from 'react'
import type { CodeLanguage } from '../../code/types'
import type { GenRes } from '@/service/debug'
import { cn } from '@langgenius/dify-ui/cn'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { useAtomValue } from 'jotai'
import * as React from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { GetCodeGeneratorResModal } from '@/app/components/app/configuration/config/code-generator/get-code-generator-res'
import { getEditorResourceId } from '@/app/components/workflow/editor-resource/resource'
import { editorResourceAtom } from '@/app/components/workflow/editor-resource/state'

type Props = Readonly<{
  nodeId: string
  currentCode?: string
  className?: string
  onGenerated?: (prompt: string) => void
  codeLanguages: CodeLanguage
}>

const CodeGenerateBtn: FC<Props> = ({
  nodeId,
  currentCode,
  className,
  codeLanguages,
  onGenerated,
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
        <GetCodeGeneratorResModal
          modelMode="chat"
          isShow={showAutomatic}
          codeLanguages={codeLanguages}
          onClose={() => setShowAutomatic(false)}
          onFinished={handleAutomaticRes}
          flowId={resourceId || ''}
          nodeId={nodeId}
          currentCode={currentCode}
        />
      )}
    </div>
  )
}
export default React.memo(CodeGenerateBtn)
