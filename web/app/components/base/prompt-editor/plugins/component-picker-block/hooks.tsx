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
import { PromptMenuItem } from './prompt-option'
import { VariableMenuItem } from './variable-option'
import { PickerBlockMenuOption } from './menu'
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

  const promptOptions: PickerBlockMenuOption[] = []
  if (contextBlock?.show) {
    promptOptions.push(new PickerBlockMenuOption({
      key: t('common.promptEditor.context.item.title'),
      group: 'prompt context',
      render: ({ isSelected, onSelect, onSetHighlight }) => {
        return <PromptMenuItem
          title={t('common.promptEditor.context.item.title')}
          icon={<File05 className='w-4 h-4 text-[#6938EF]' />}
          disabled={!contextBlock.selectable}
          isSelected={isSelected}
          onClick={onSelect}
          onMouseEnter={onSetHighlight}
        />
      },
      onSelect: () => {
        if (!contextBlock?.selectable)
          return
        editor.dispatchCommand(INSERT_CONTEXT_BLOCK_COMMAND, undefined)
      },
    }))
  }

  if (queryBlock?.show) {
    promptOptions.push(
      new PickerBlockMenuOption({
        key: t('common.promptEditor.query.item.title'),
        group: 'prompt query',
        render: ({ isSelected, onSelect, onSetHighlight }) => {
          return (
            <PromptMenuItem
              title={t('common.promptEditor.query.item.title')}
              icon={<UserEdit02 className='w-4 h-4 text-[#FD853A]' />}
              disabled={!queryBlock.selectable}
              isSelected={isSelected}
              onClick={onSelect}
              onMouseEnter={onSetHighlight}
            />
          )
        },
        onSelect: () => {
          if (!queryBlock?.selectable)
            return
          editor.dispatchCommand(INSERT_QUERY_BLOCK_COMMAND, undefined)
        },
      }),
    )
  }

  if (historyBlock?.show) {
    promptOptions.push(
      new PickerBlockMenuOption({
        key: t('common.promptEditor.history.item.title'),
        group: 'prompt history',
        render: ({ isSelected, onSelect, onSetHighlight }) => {
          return (
            <PromptMenuItem
              title={t('common.promptEditor.history.item.title')}
              icon={<MessageClockCircle className='w-4 h-4 text-[#DD2590]' />}
              disabled={!historyBlock.selectable
              }
              isSelected={isSelected}
              onClick={onSelect}
              onMouseEnter={onSetHighlight}
            />
          )
        },
        onSelect: () => {
          if (!historyBlock?.selectable)
            return
          editor.dispatchCommand(INSERT_HISTORY_BLOCK_COMMAND, undefined)
        },
      }),
    )
  }
  return promptOptions
}

export const useVariableOptions = (
  variableBlock?: VariableBlockType,
  queryString?: string,
): PickerBlockMenuOption[] => {
  const { t } = useTranslation()
  const [editor] = useLexicalComposerContext()

  const options = useMemo(() => {
    if (!variableBlock?.variables)
      return []

    const baseOptions = (variableBlock.variables).map((item) => {
      return new PickerBlockMenuOption({
        key: item.value,
        group: 'prompt variable',
        render: ({ queryString, isSelected, onSelect, onSetHighlight }) => {
          return (
            <VariableMenuItem
              title={item.value}
              icon={<BracketsX className='w-[14px] h-[14px] text-[#2970FF]' />}
              queryString={queryString}
              isSelected={isSelected}
              onClick={onSelect}
              onMouseEnter={onSetHighlight}
            />
          )
        },
        onSelect: () => {
          editor.dispatchCommand(INSERT_VARIABLE_VALUE_BLOCK_COMMAND, `{{${item.value}}}`)
        },
      })
    })
    if (!queryString)
      return baseOptions

    const regex = new RegExp(queryString, 'i')

    return baseOptions.filter(option => regex.test(option.key))
  }, [editor, queryString, variableBlock])

  const addOption = useMemo(() => {
    return new PickerBlockMenuOption({
      key: t('common.promptEditor.variable.modal.add'),
      group: 'prompt variable',
      render: ({ queryString, isSelected, onSelect, onSetHighlight }) => {
        return (
          <VariableMenuItem
            title={t('common.promptEditor.variable.modal.add')}
            icon={<BracketsX className='mr-2 w-[14px] h-[14px] text-[#2970FF]' />}
            queryString={queryString}
            isSelected={isSelected}
            onClick={onSelect}
            onMouseEnter={onSetHighlight}
          />
        )
      },
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
    if (!externalToolBlockType?.externalTools)
      return []
    const baseToolOptions = (externalToolBlockType.externalTools).map((item) => {
      return new PickerBlockMenuOption({
        key: item.name,
        group: 'external tool',
        render: ({ queryString, isSelected, onSelect, onSetHighlight }) => {
          return (
            <VariableMenuItem
              title={item.name}
              icon={
                <AppIcon
                  className='!w-[14px] !h-[14px]'
                  icon={item.icon}
                  background={item.icon_background}
                />
              }
              extraElement={<div className='text-xs text-gray-400'>{item.variableName}</div>}
              queryString={queryString}
              isSelected={isSelected}
              onClick={onSelect}
              onMouseEnter={onSetHighlight}
            />
          )
        },
        onSelect: () => {
          editor.dispatchCommand(INSERT_VARIABLE_VALUE_BLOCK_COMMAND, `{{${item.variableName}}}`)
        },
      })
    })
    if (!queryString)
      return baseToolOptions

    const regex = new RegExp(queryString, 'i')

    return baseToolOptions.filter(option => regex.test(option.key))
  }, [editor, queryString, externalToolBlockType])

  const addOption = useMemo(() => {
    return new PickerBlockMenuOption({
      key: t('common.promptEditor.variable.modal.addTool'),
      group: 'external tool',
      render: ({ queryString, isSelected, onSelect, onSetHighlight }) => {
        return (
          <VariableMenuItem
            title={t('common.promptEditor.variable.modal.addTool')}
            icon={<Tool03 className='mr-2 w-[14px] h-[14px] text-[#444CE7]' />}
            extraElement={< ArrowUpRight className='w-3 h-3 text-gray-400' />}
            queryString={queryString}
            isSelected={isSelected}
            onClick={onSelect}
            onMouseEnter={onSetHighlight}
          />
        )
      },
      onSelect: () => {
        externalToolBlockType?.onAddExternalTool?.()
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
      workflowVariableOptions,
      allFlattenOptions: [...promptOptions, ...variableOptions, ...externalToolOptions],
    }
  }, [promptOptions, variableOptions, externalToolOptions, workflowVariableOptions])
}
