'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import { useBoolean } from 'ahooks'
import cn from 'classnames'
import type { CodeLanguage } from '../../code/types'
import { Generator } from '@/app/components/base/icons/src/vender/other'
import { ActionButton } from '@/app/components/base/action-button'
import { AppType } from '@/types/app'
import type { GenRes } from '@/service/debug'
import { GetCodeGeneratorResModal } from '@/app/components/app/configuration/config/code-generator/get-code-generator-res'
import { useHooksStore } from '../../../hooks-store'

type Props = {
  nodeId: string
  currentCode?: string
  className?: string
  onGenerated?: (prompt: string) => void
  codeLanguages: CodeLanguage
}

const CodeGenerateBtn: FC<Props> = ({
  nodeId,
  currentCode,
  className,
  codeLanguages,
  onGenerated,
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
        className='hover:bg-[#155EFF]/8'
        onClick={showAutomaticTrue}>
        <Generator className='h-4 w-4 text-primary-600' />
      </ActionButton>
      {showAutomatic && (
        <GetCodeGeneratorResModal
          mode={AppType.chat}
          isShow={showAutomatic}
          codeLanguages={codeLanguages}
          onClose={showAutomaticFalse}
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
