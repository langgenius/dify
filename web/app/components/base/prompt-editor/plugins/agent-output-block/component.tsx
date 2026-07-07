import type { DeclaredOutputConfig } from '@dify/contracts/api/console/apps/types.gen'
import type { AgentOutputTypeOptionValue } from './utils'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectLabel,
  SelectTrigger,
} from '@langgenius/dify-ui/select'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $getNodeByKey, $getRoot } from 'lexical'
import { memo, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { $isAgentOutputBlockNode } from './node'
import {
  AGENT_OUTPUT_NAME_PATTERN,
  AGENT_OUTPUT_TYPE_OPTIONS,
  createAgentOutputConfig,
  getAgentOutputTypeOption,
  inferAgentOutputType,
  replaceAgentOutputName,
} from './utils'

type AgentOutputBlockComponentProps = {
  nodeKey: string
  name: string
  outputType: AgentOutputTypeOptionValue
  isEditing: boolean
  selectNameOnEdit?: boolean
  openTypeSelectOnEdit?: boolean
  outputs: DeclaredOutputConfig[]
  onChange?: (outputs: DeclaredOutputConfig[], prompt?: string) => void
  onEdit?: (name: string, outputType: AgentOutputTypeOptionValue) => void
}

function upsertOutput(
  outputs: DeclaredOutputConfig[],
  oldName: string,
  nextName: string,
  outputType: AgentOutputTypeOptionValue,
) {
  const trimmedName = nextName.trim()
  if (!AGENT_OUTPUT_NAME_PATTERN.test(trimmedName))
    return null

  const nextOutputType = inferAgentOutputType(trimmedName, outputType)
  const existingIndex = outputs.findIndex(output => output.name === oldName)
  const duplicateIndex = outputs.findIndex(output => output.name === trimmedName && output.name !== oldName)
  if (duplicateIndex >= 0)
    return null

  const nextOutput = createAgentOutputConfig(trimmedName, nextOutputType)
  if (existingIndex >= 0)
    return outputs.map((output, index) => index === existingIndex ? nextOutput : output)

  return [...outputs, nextOutput]
}

const AgentOutputBlockComponent = ({
  nodeKey,
  name,
  outputType,
  isEditing,
  selectNameOnEdit = isEditing,
  openTypeSelectOnEdit = false,
  outputs,
  onChange,
  onEdit,
}: AgentOutputBlockComponentProps) => {
  const { t } = useTranslation()
  const [editor] = useLexicalComposerContext()
  const selected = getAgentOutputTypeOption(outputType)
  const [draftName, setDraftName] = useState(name)
  const [lastNodeName, setLastNodeName] = useState(name)
  const [typeSelectOpen, setTypeSelectOpen] = useState(openTypeSelectOnEdit)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const skipNextBlurCommitRef = useRef(false)
  const latestDraftNameRef = useRef(name)
  const skipNameFocusRef = useRef(false)

  useEffect(() => {
    if (!isEditing)
      return
    if (skipNameFocusRef.current) {
      skipNameFocusRef.current = false
      return
    }

    const input = nameInputRef.current
    if (!input)
      return

    input.focus()
    if (selectNameOnEdit)
      input.setSelectionRange(0, input.value.length)
    else
      input.setSelectionRange(input.value.length, input.value.length)
  }, [isEditing, selectNameOnEdit])

  if (name !== lastNodeName) {
    setLastNodeName(name)
    setDraftName(name)
    latestDraftNameRef.current = name
  }

  const commitOutput = (
    nextName: string,
    nextType: AgentOutputTypeOptionValue,
    options: {
      keepEditing?: boolean
      openTypeSelectOnEdit?: boolean
      selectAfterCommit?: boolean
    } = {},
  ) => {
    const {
      keepEditing = false,
      openTypeSelectOnEdit = false,
      selectAfterCommit = false,
    } = options
    const trimmedName = nextName.trim()
    const nextOutputs = upsertOutput(outputs, name, trimmedName, nextType)
    if (!nextOutputs) {
      setDraftName(name)
      return false
    }

    let didCommit = false
    let nextPrompt: string | undefined
    editor.update(() => {
      const node = $getNodeByKey(nodeKey)
      if (!$isAgentOutputBlockNode(node))
        return

      const currentPrompt = $getRoot().getChildren().map(node => node.getTextContent()).join('\n')
      const nextOutputType = inferAgentOutputType(trimmedName, nextType)
      node.setOutput(trimmedName, nextOutputType, keepEditing, nextOutputs, onChange, onEdit, false, openTypeSelectOnEdit)
      if (selectAfterCommit)
        node.selectNext()
      nextPrompt = replaceAgentOutputName(currentPrompt, name, trimmedName)
      didCommit = true
    })

    if (!didCommit)
      return false

    onChange?.(nextOutputs, nextPrompt)
    setDraftName(trimmedName)
    latestDraftNameRef.current = trimmedName

    return true
  }

  const handleTypeSelectOpenChange = (open: boolean) => {
    setTypeSelectOpen(open)
    if (!open) {
      skipNextBlurCommitRef.current = false
      editor.update(() => {
        const node = $getNodeByKey(nodeKey)
        if ($isAgentOutputBlockNode(node))
          node.setOpenTypeSelectOnEdit(false)
      })
    }
  }

  if (!isEditing) {
    return (
      <span
        contentEditable={false}
        className="group/agent-output inline-flex min-w-[18px] items-center gap-1 rounded-[5px] border border-util-colors-violet-violet-100 bg-util-colors-violet-violet-50 px-1 py-0.5 align-middle shadow-xs"
        onMouseEnter={() => onEdit?.(name, outputType)}
      >
        <span aria-hidden="true" className="i-custom-vender-workflow-variable-x size-3.5 shrink-0 text-util-colors-violet-violet-700 group-hover/agent-output:hidden" />
        <span aria-hidden="true" className="i-ri-edit-2-line hidden size-3.5 shrink-0 text-util-colors-violet-violet-700 group-hover/agent-output:inline-block" />
        <span className="system-xs-medium whitespace-nowrap text-util-colors-violet-violet-700">
          {name}
        </span>
        <span className="rounded-[3px] px-0.5 system-2xs-medium-uppercase whitespace-nowrap text-text-tertiary">
          {selected.label}
        </span>
      </span>
    )
  }

  return (
    <span
      contentEditable={false}
      className="inline-flex items-center gap-[3px] rounded-[5px] border border-util-colors-violet-violet-700 bg-util-colors-violet-violet-50 p-px align-middle shadow-xs"
    >
      <span className="flex min-w-0 items-center gap-0.5 pl-0.5">
        <span aria-hidden="true" className="i-custom-vender-workflow-variable-x size-3.5 shrink-0 text-util-colors-violet-violet-700" />
        <input
          ref={nameInputRef}
          aria-label={t('nodes.agent.outputVars.nameLabel', { ns: 'workflow' })}
          value={draftName}
          className="h-4 max-w-28 min-w-5 border-0 bg-transparent p-0 text-center system-xs-regular text-util-colors-violet-violet-700 outline-hidden placeholder:text-util-colors-violet-violet-700/50 focus:w-24"
          placeholder={t('nodes.agent.outputVars.namePlaceholder', { ns: 'workflow' })}
          onMouseDown={event => event.stopPropagation()}
          onClick={event => event.stopPropagation()}
          onKeyDown={(event) => {
            event.stopPropagation()
            event.nativeEvent.stopImmediatePropagation?.()
            if (event.key === 'Enter' || event.key === 'Tab') {
              event.preventDefault()
              skipNextBlurCommitRef.current = true
              const isTabCommit = event.key === 'Tab'
              const didCommit = commitOutput(event.currentTarget.value, outputType, {
                keepEditing: isTabCommit,
                openTypeSelectOnEdit: isTabCommit,
                selectAfterCommit: !isTabCommit,
              })
              if (!didCommit) {
                skipNextBlurCommitRef.current = false
                return
              }

              if (isTabCommit) {
                skipNameFocusRef.current = true
                event.currentTarget.setSelectionRange(event.currentTarget.value.length, event.currentTarget.value.length)
                event.currentTarget.blur()
                setTypeSelectOpen(true)
                return
              }

              queueMicrotask(() => {
                editor.focus()
              })
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              setDraftName(name)
              event.currentTarget.blur()
            }
          }}
          onChange={(event) => {
            latestDraftNameRef.current = event.currentTarget.value
            setDraftName(event.currentTarget.value)
          }}
          onBlur={(event) => {
            if (skipNextBlurCommitRef.current) {
              skipNextBlurCommitRef.current = false
              return
            }

            commitOutput(event.currentTarget.value, outputType)
          }}
        />
      </span>
      <Select<AgentOutputTypeOptionValue>
        open={typeSelectOpen}
        onOpenChange={handleTypeSelectOpenChange}
        value={outputType}
        onValueChange={(nextType) => {
          skipNextBlurCommitRef.current = false
          setTypeSelectOpen(false)
          if (nextType)
            commitOutput(latestDraftNameRef.current, nextType)
        }}
      >
        <SelectLabel className="sr-only">
          {t('nodes.agent.outputVars.typeLabel', { ns: 'workflow' })}
        </SelectLabel>
        <SelectTrigger
          aria-label={t('nodes.agent.outputVars.typeLabel', { ns: 'workflow' })}
          className="h-4 min-w-4 rounded bg-util-colors-violet-violet-200 py-0 pr-0.5 pl-1 system-2xs-semibold-uppercase text-util-colors-violet-violet-700 hover:bg-util-colors-violet-violet-200"
          onMouseDown={() => {
            skipNextBlurCommitRef.current = true
          }}
          onClick={event => event.stopPropagation()}
        >
          {selected.label}
        </SelectTrigger>
        <SelectContent popupClassName="w-40">
          {AGENT_OUTPUT_TYPE_OPTIONS.map(option => (
            <SelectItem key={option.value} value={option.value}>
              <SelectItemText>{option.label}</SelectItemText>
              <SelectItemIndicator />
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </span>
  )
}

export default memo(AgentOutputBlockComponent)
