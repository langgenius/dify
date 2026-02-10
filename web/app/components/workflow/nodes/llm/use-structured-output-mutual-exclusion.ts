import type { LLMNodeType } from './types'
import type { ToolDependency } from './use-node-skills'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { getToolTokenListRegexString, getToolTokenRegexString } from '@/app/components/workflow/skill/editor/skill-editor/plugins/tool-block/utils'

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
  const toolTokenRegex = useMemo(() => new RegExp(getToolTokenRegexString()), [])
  const toolTokenListRegex = useMemo(() => new RegExp(getToolTokenListRegexString()), [])
  const hasToolTokensInText = useMemo(() => {
    return (value?: string) => {
      if (!value)
        return false
      return toolTokenRegex.test(value) || toolTokenListRegex.test(value)
    }
  }, [toolTokenListRegex, toolTokenRegex])
  const hasToolTokensInPrompt = useMemo(() => {
    const template = inputs.prompt_template
    const check = hasToolTokensInText
    if (Array.isArray(template)) {
      return template.some((item) => {
        if ('text' in item && check(item.text))
          return true
        if ('jinja2_text' in item && check(item.jinja2_text))
          return true
        return false
      })
    }
    return check(template.text) || check(template.jinja2_text)
  }, [hasToolTokensInText, inputs.prompt_template])
  const isStructuredOutputEnabled = !!inputs.structured_output_enabled
  const hasToolDependencies = isSupportSandbox && (toolDependencies.length > 0 || hasToolTokensInPrompt)
  const hasEnabledTools = (inputs.tools?.length ?? 0) > 0
  const hasToolConflict = !!inputs.computer_use || hasToolDependencies || hasEnabledTools

  const isStructuredOutputBlocked = readOnly || (hasToolConflict && !isStructuredOutputEnabled)
  const isComputerUseBlocked = readOnly || (isStructuredOutputEnabled && !inputs.computer_use)
  const isToolsBlocked = readOnly || isStructuredOutputEnabled
  const shouldEnableComputerUseForPromptTools = isSupportSandbox
    && !readOnly
    && !inputs.computer_use
    && hasToolDependencies
    && !isComputerUseBlocked
  const disableToolBlocks = isStructuredOutputEnabled || shouldEnableComputerUseForPromptTools

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
    shouldEnableComputerUseForPromptTools,
    structuredOutputDisabledTip,
    computerUseDisabledTip,
    toolsDisabledTip,
  }
}
