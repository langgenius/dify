import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { $insertNodes } from 'lexical'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import type {
  ContextBlockType,
  ExternalToolBlockType,
  HistoryBlockType,
  QueryBlockType,
  VariableBlockType,
  WorkflowVariableBlockType,
} from '../../types'
import { INSERT_CONTEXT_BLOCK_COMMAND } from '../context-block'
import { INSERT_HISTORY_BLOCK_COMMAND } from '../history-block'
import { INSERT_QUERY_BLOCK_COMMAND } from '../query-block'
import { INSERT_VARIABLE_VALUE_BLOCK_COMMAND } from '../variable-block'
import { $createCustomTextNode } from '../custom-text/node'
import { PromptOption } from './prompt-option'
import { VariableOption } from './variable-option'
import { File05 } from '@/app/components/base/icons/src/vender/solid/files'
import {
  MessageClockCircle,
  Tool03,
} from '@/app/components/base/icons/src/vender/solid/general'
import { BracketsX } from '@/app/components/base/icons/src/vender/line/development'
import { UserEdit02 } from '@/app/components/base/icons/src/vender/solid/users'
import { ArrowUpRight } from '@/app/components/base/icons/src/vender/line/arrows'
import AppIcon from '@/app/components/base/app-icon'

export const usePromptOptions = (
  contextBlock?: ContextBlockType,
  queryBlock?: QueryBlockType,
  historyBlock?: HistoryBlockType,
) => {
  const { t } = useTranslation()
  const [editor] = useLexicalComposerContext()

  return useMemo(() => {
    return [
      ...contextBlock?.show
        ? [
          new PromptOption(t('common.promptEditor.context.item.title'), {
            icon: <File05 className='w-4 h-4 text-[#6938EF]' />,
            onSelect: () => {
              if (!contextBlock?.selectable)
                return
              editor.dispatchCommand(INSERT_CONTEXT_BLOCK_COMMAND, undefined)
            },
            disabled: !contextBlock?.selectable,
          }),
        ]
        : [],
      ...queryBlock?.show
        ? [
          new PromptOption(t('common.promptEditor.query.item.title'), {
            icon: <UserEdit02 className='w-4 h-4 text-[#FD853A]' />,
            onSelect: () => {
              if (!queryBlock?.selectable)
                return
              editor.dispatchCommand(INSERT_QUERY_BLOCK_COMMAND, undefined)
            },
            disabled: !queryBlock?.selectable,
          }),
        ]
        : [],
      ...historyBlock?.show
        ? [
          new PromptOption(t('common.promptEditor.history.item.title'), {
            icon: <MessageClockCircle className='w-4 h-4 text-[#DD2590]' />,
            onSelect: () => {
              if (!historyBlock?.selectable)
                return
              editor.dispatchCommand(INSERT_HISTORY_BLOCK_COMMAND, undefined)
            },
            disabled: !historyBlock?.selectable,
          }),
        ]
        : [],
    ]
  }, [contextBlock, editor, historyBlock, queryBlock, t])
}

export const useVariableOptions = (
  variableBlock?: VariableBlockType,
  queryString?: string,
) => {
  const { t } = useTranslation()
  const [editor] = useLexicalComposerContext()

  const options = useMemo(() => {
    const baseOptions = (variableBlock?.variables || []).map((item) => {
      return new VariableOption(item.value, {
        icon: <BracketsX className='w-[14px] h-[14px] text-[#2970FF]' />,
        onSelect: () => {
          editor.dispatchCommand(INSERT_VARIABLE_VALUE_BLOCK_COMMAND, `{{${item.value}}}`)
        },
      })
    })
    if (!queryString)
      return baseOptions

    const regex = new RegExp(queryString, 'i')

    return baseOptions.filter(option => regex.test(option.title) || option.keywords.some(keyword => regex.test(keyword)))
  }, [editor, queryString, variableBlock])

  const addOption = useMemo(() => {
    return new VariableOption(t('common.promptEditor.variable.modal.add'), {
      icon: <BracketsX className='mr-2 w-[14px] h-[14px] text-[#2970FF]' />,
      onSelect: () => {
        editor.update(() => {
          const prefixNode = $createCustomTextNode('{{')
          const suffixNode = $createCustomTextNode('}}')
          $insertNodes([prefixNode, suffixNode])
          prefixNode.select()
        })
      },
    })
  }, [editor, t])

  return useMemo(() => {
    return variableBlock?.show ? [...options, addOption] : []
  }, [options, addOption, variableBlock?.show])
}

export const useExternalToolOptions = (
  externalToolBlockType?: ExternalToolBlockType,
  queryString?: string,
) => {
  const { t } = useTranslation()
  const [editor] = useLexicalComposerContext()

  const options = useMemo(() => {
    const baseToolOptions = (externalToolBlockType?.externalTools || []).map((item) => {
      return new VariableOption(item.name, {
        icon: (
          <AppIcon
            className='!w-[14px] !h-[14px]'
            icon={item.icon}
            background={item.icon_background}
          />
        ),
        extraElement: <div className='text-xs text-gray-400'>{item.variableName}</div>,
        onSelect: () => {
          editor.dispatchCommand(INSERT_VARIABLE_VALUE_BLOCK_COMMAND, `{{${item.variableName}}}`)
        },
      })
    })
    if (!queryString)
      return baseToolOptions

    const regex = new RegExp(queryString, 'i')

    return baseToolOptions.filter(option => regex.test(option.title) || option.keywords.some(keyword => regex.test(keyword)))
  }, [editor, queryString, externalToolBlockType])

  const addOption = useMemo(() => {
    return new VariableOption(t('common.promptEditor.variable.modal.addTool'), {
      icon: <Tool03 className='mr-2 w-[14px] h-[14px] text-[#444CE7]' />,
      extraElement: <ArrowUpRight className='w-3 h-3 text-gray-400' />,
      onSelect: () => {
        if (externalToolBlockType?.onAddExternalTool)
          externalToolBlockType.onAddExternalTool()
      },
    })
  }, [externalToolBlockType, t])

  return useMemo(() => {
    return externalToolBlockType?.show ? [...options, addOption] : []
  }, [options, addOption, externalToolBlockType?.show])
}

export const useOptions = (
  contextBlock?: ContextBlockType,
  queryBlock?: QueryBlockType,
  historyBlock?: HistoryBlockType,
  variableBlock?: VariableBlockType,
  externalToolBlockType?: ExternalToolBlockType,
  workflowVariableBlockType?: WorkflowVariableBlockType,
  queryString?: string,
) => {
  const promptOptions = usePromptOptions(contextBlock, queryBlock, historyBlock)
  const variableOptions = useVariableOptions(variableBlock, queryString)
  const externalToolOptions = useExternalToolOptions(externalToolBlockType, queryString)
  const workflowVariableOptions = useMemo(() => {
    if (!workflowVariableBlockType?.show)
      return []

    return workflowVariableBlockType.variables || []
  }, [workflowVariableBlockType])

  return useMemo(() => {
    return {
      promptOptions,
      variableOptions,
      externalToolOptions,
      workflowVariableOptions,
      allOptions: [...promptOptions, ...variableOptions, ...externalToolOptions],
    }
  }, [promptOptions, variableOptions, externalToolOptions, workflowVariableOptions])
}
