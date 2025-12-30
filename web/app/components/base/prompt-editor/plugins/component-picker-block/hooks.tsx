import type {
  ContextBlockType,
  CurrentBlockType,
  ErrorMessageBlockType,
  ExternalToolBlockType,
  HistoryBlockType,
  LastRunBlockType,
  QueryBlockType,
  VariableBlockType,
  WorkflowVariableBlockType,
} from '../../types'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $insertNodes } from 'lexical'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import { ArrowUpRight } from '@/app/components/base/icons/src/vender/line/arrows'
import { BracketsX } from '@/app/components/base/icons/src/vender/line/development'
import { File05 } from '@/app/components/base/icons/src/vender/solid/files'
import {
  MessageClockCircle,
  Tool03,
} from '@/app/components/base/icons/src/vender/solid/general'
import { UserEdit02 } from '@/app/components/base/icons/src/vender/solid/users'
import { VarType } from '@/app/components/workflow/types'
import { INSERT_CONTEXT_BLOCK_COMMAND } from '../context-block'
import { $createCustomTextNode } from '../custom-text/node'
import { INSERT_HISTORY_BLOCK_COMMAND } from '../history-block'
import { INSERT_QUERY_BLOCK_COMMAND } from '../query-block'
import { INSERT_VARIABLE_VALUE_BLOCK_COMMAND } from '../variable-block'
import { PickerBlockMenuOption } from './menu'
import { PromptMenuItem } from './prompt-option'
import { VariableMenuItem } from './variable-option'

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
      key: t('promptEditor.context.item.title', { ns: 'common' }),
      group: 'prompt context',
      render: ({ isSelected, onSelect, onSetHighlight }) => {
        return (
          <PromptMenuItem
            title={t('promptEditor.context.item.title', { ns: 'common' })}
            icon={<File05 className="h-4 w-4 text-[#6938EF]" />}
            disabled={!contextBlock.selectable}
            isSelected={isSelected}
            onClick={onSelect}
            onMouseEnter={onSetHighlight}
          />
        )
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
        key: t('promptEditor.query.item.title', { ns: 'common' }),
        group: 'prompt query',
        render: ({ isSelected, onSelect, onSetHighlight }) => {
          return (
            <PromptMenuItem
              title={t('promptEditor.query.item.title', { ns: 'common' })}
              icon={<UserEdit02 className="h-4 w-4 text-[#FD853A]" />}
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
        key: t('promptEditor.history.item.title', { ns: 'common' }),
        group: 'prompt history',
        render: ({ isSelected, onSelect, onSetHighlight }) => {
          return (
            <PromptMenuItem
              title={t('promptEditor.history.item.title', { ns: 'common' })}
              icon={<MessageClockCircle className="h-4 w-4 text-[#DD2590]" />}
              disabled={!historyBlock.selectable}
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
              icon={<BracketsX className="h-[14px] w-[14px] text-text-accent" />}
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
      key: t('promptEditor.variable.modal.add', { ns: 'common' }),
      group: 'prompt variable',
      render: ({ queryString, isSelected, onSelect, onSetHighlight }) => {
        return (
          <VariableMenuItem
            title={t('promptEditor.variable.modal.add', { ns: 'common' })}
            icon={<BracketsX className="h-[14px] w-[14px] text-text-accent" />}
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
              icon={(
                <AppIcon
                  className="!h-[14px] !w-[14px]"
                  icon={item.icon}
                  background={item.icon_background}
                />
              )}
              extraElement={<div className="text-xs text-text-tertiary">{item.variableName}</div>}
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
      key: t('promptEditor.variable.modal.addTool', { ns: 'common' }),
      group: 'external tool',
      render: ({ queryString, isSelected, onSelect, onSetHighlight }) => {
        return (
          <VariableMenuItem
            title={t('promptEditor.variable.modal.addTool', { ns: 'common' })}
            icon={<Tool03 className="h-[14px] w-[14px] text-text-accent" />}
            extraElement={<ArrowUpRight className="h-3 w-3 text-text-tertiary" />}
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
  currentBlockType?: CurrentBlockType,
  errorMessageBlockType?: ErrorMessageBlockType,
  lastRunBlockType?: LastRunBlockType,
  queryString?: string,
) => {
  const promptOptions = usePromptOptions(contextBlock, queryBlock, historyBlock)
  const variableOptions = useVariableOptions(variableBlock, queryString)
  const externalToolOptions = useExternalToolOptions(externalToolBlockType, queryString)

  const workflowVariableOptions = useMemo(() => {
    if (!workflowVariableBlockType?.show)
      return []
    const res = workflowVariableBlockType.variables || []
    if (errorMessageBlockType?.show && res.findIndex(v => v.nodeId === 'error_message') === -1) {
      res.unshift({
        nodeId: 'error_message',
        title: 'error_message',
        isFlat: true,
        vars: [
          {
            variable: 'error_message',
            type: VarType.string,
          },
        ],
      })
    }
    if (lastRunBlockType?.show && res.findIndex(v => v.nodeId === 'last_run') === -1) {
      res.unshift({
        nodeId: 'last_run',
        title: 'last_run',
        isFlat: true,
        vars: [
          {
            variable: 'last_run',
            type: VarType.object,
          },
        ],
      })
    }
    if (currentBlockType?.show && res.findIndex(v => v.nodeId === 'current') === -1) {
      const title = currentBlockType.generatorType === 'prompt' ? 'current_prompt' : 'current_code'
      res.unshift({
        nodeId: 'current',
        title,
        isFlat: true,
        vars: [
          {
            variable: 'current',
            type: VarType.string,
          },
        ],
      })
    }
    return res
  }, [workflowVariableBlockType?.show, workflowVariableBlockType?.variables, errorMessageBlockType?.show, lastRunBlockType?.show, currentBlockType?.show, currentBlockType?.generatorType])

  return useMemo(() => {
    return {
      workflowVariableOptions,
      allFlattenOptions: [...promptOptions, ...variableOptions, ...externalToolOptions],
    }
  }, [promptOptions, variableOptions, externalToolOptions, workflowVariableOptions])
}
