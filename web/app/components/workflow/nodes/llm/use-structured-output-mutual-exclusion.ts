import type { LLMNodeType } from './types'
import type { ToolDependency } from './use-node-skills'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

type Params = {
  inputs: LLMNodeType
  readOnly: boolean
  isSupportSandbox: boolean
  toolDependencies: ToolDependency[]
}

export const useStructuredOutputMutualExclusion = ({
  inputs,
  readOnly,
  isSupportSandbox,
  toolDependencies,
}: Params) => {
  const { t } = useTranslation()
  const isStructuredOutputEnabled = !!inputs.structured_output_enabled
  const hasToolDependencies = isSupportSandbox && toolDependencies.length > 0
  const hasEnabledTools = (inputs.tools?.length ?? 0) > 0
  const hasToolConflict = !!inputs.computer_use || hasToolDependencies || hasEnabledTools

  const isStructuredOutputBlocked = readOnly || (hasToolConflict && !isStructuredOutputEnabled)
  const isComputerUseBlocked = readOnly || (isStructuredOutputEnabled && !inputs.computer_use)
  const isToolsBlocked = readOnly || isStructuredOutputEnabled
  const disableToolBlocks = isStructuredOutputEnabled

  const structuredOutputDisabledTip = useMemo(() => {
    if (readOnly || !isStructuredOutputBlocked)
      return ''
    return inputs.computer_use
      ? t('structOutput.disabledByComputerUse', { ns: 'app' })
      : t('structOutput.disabledByTools', { ns: 'app' })
  }, [inputs.computer_use, isStructuredOutputBlocked, readOnly, t])

  const computerUseDisabledTip = useMemo(() => {
    if (readOnly || !isComputerUseBlocked)
      return ''
    return t('nodes.llm.computerUse.disabledByStructuredOutput', { ns: 'workflow' })
  }, [isComputerUseBlocked, readOnly, t])

  const toolsDisabledTip = useMemo(() => {
    if (readOnly || !isToolsBlocked)
      return ''
    return t('nodes.llm.tools.disabledByStructuredOutput', { ns: 'workflow' })
  }, [isToolsBlocked, readOnly, t])

  return {
    isStructuredOutputBlocked,
    isComputerUseBlocked,
    isToolsBlocked,
    disableToolBlocks,
    structuredOutputDisabledTip,
    computerUseDisabledTip,
    toolsDisabledTip,
  }
}
