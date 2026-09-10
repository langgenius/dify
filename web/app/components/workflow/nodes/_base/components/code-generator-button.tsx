'use client'
import type { FC } from 'react'
import type { CodeLanguage } from '../../code/types'
import type { GenRes } from '@/service/debug'
import { cn } from '@langgenius/dify-ui/cn'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import * as React from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { GetCodeGeneratorResModal } from '@/app/components/app/configuration/config/code-generator/get-code-generator-res'
import { Generator } from '@/app/components/base/icons/src/vender/other'
import { AppModeEnum } from '@/types/app'
import { useHooksStore } from '../../../hooks-store'

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
        <GetCodeGeneratorResModal
          mode={AppModeEnum.CHAT}
          isShow={showAutomatic}
          codeLanguages={codeLanguages}
          onClose={() => setShowAutomatic(false)}
          onFinished={handleAutomaticRes}
          flowId={configsMap?.flowId || ''}
          nodeId={nodeId}
          currentCode={currentCode}
        />
      )}
    </div>
  )
}
export default React.memo(CodeGenerateBtn)
