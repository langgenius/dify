'use client'
import type { FC } from 'react'
import type { CodeLanguage } from '../../code/types'
import type { GenRes } from '@/service/debug'
import { useBoolean } from 'ahooks'
import * as React from 'react'
import { useCallback, useMemo } from 'react'
import { GetCodeGeneratorResModal } from '@/app/components/app/configuration/config/code-generator/get-code-generator-res'
import { ActionButton } from '@/app/components/base/action-button'
import { Generator } from '@/app/components/base/icons/src/vender/other'
import { AppModeEnum } from '@/types/app'
import { cn } from '@/utils/classnames'
import { useHooksStore } from '../../../hooks-store'
import { useStore } from '../../../store'
import { BlockEnum } from '../../../types'
import ContextGenerateModal from '../../tool/components/context-generate-modal'

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
  const nodes = useStore(s => s.nodes)
  const handleAutomaticRes = useCallback((res: GenRes) => {
    onGenerated?.(res.modified)
    showAutomaticFalse()
  }, [onGenerated, showAutomaticFalse])
  const configsMap = useHooksStore(s => s.configsMap)

  const parseExtractorNodeId = useCallback((id: string) => {
    const marker = '_ext_'
    const index = id.lastIndexOf(marker)
    if (index < 0)
      return null
    const parentId = id.slice(0, index)
    const paramKey = id.slice(index + marker.length)
    if (!parentId || !paramKey)
      return null
    return { parentId, paramKey }
  }, [])

  const contextGenerateConfig = useMemo(() => {
    const targetNode = nodes.find(node => node.id === nodeId)
    const isCodeNode = targetNode?.data?.type === BlockEnum.Code
    const parentNodeId = (targetNode?.data as { parent_node_id?: string })?.parent_node_id
    const parsed = parseExtractorNodeId(nodeId)
    if (!isCodeNode || !parentNodeId || !parsed?.paramKey)
      return null
    return {
      toolNodeId: parentNodeId || parsed.parentId,
      paramKey: parsed.paramKey,
      codeNodeId: nodeId,
    }
  }, [nodeId, nodes, parseExtractorNodeId])

  return (
    <div className={cn(className)}>
      <ActionButton
        className="hover:bg-[#155EFF]/8"
        onClick={showAutomaticTrue}
      >
        <Generator className="h-4 w-4 text-primary-600" />
      </ActionButton>
      {showAutomatic && (
        contextGenerateConfig
          ? (
              <ContextGenerateModal
                isShow={showAutomatic}
                onClose={showAutomaticFalse}
                toolNodeId={contextGenerateConfig.toolNodeId}
                paramKey={contextGenerateConfig.paramKey}
                codeNodeId={contextGenerateConfig.codeNodeId}
              />
            )
          : (
              <GetCodeGeneratorResModal
                mode={AppModeEnum.CHAT}
                isShow={showAutomatic}
                codeLanguages={codeLanguages}
                onClose={showAutomaticFalse}
                onFinished={handleAutomaticRes}
                flowId={configsMap?.flowId || ''}
                nodeId={nodeId}
                currentCode={currentCode}
              />
            )
      )}
    </div>
  )
}
export default React.memo(CodeGenerateBtn)
