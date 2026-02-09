import type { LexicalNode } from 'lexical'
import type { ToolParameter } from '@/app/components/tools/types'
import type { ToolDefaultValue } from '@/app/components/workflow/block-selector/types'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { LexicalTypeaheadMenuPlugin, MenuOption } from '@lexical/react/LexicalTypeaheadMenuPlugin'
import {
  $createTextNode,
  $getSelection,
  $insertNodes,
  $isRangeSelection,
} from 'lexical'
import * as React from 'react'
import { useCallback, useMemo, useState } from 'react'
import ReactDOM from 'react-dom'
import { v4 as uuid } from 'uuid'
import { useShallow } from 'zustand/react/shallow'
import { useBasicTypeaheadTriggerMatch } from '@/app/components/base/prompt-editor/hooks'
import { $splitNodeContainingQuery } from '@/app/components/base/prompt-editor/utils'
import { FormTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { toolParametersToFormSchemas } from '@/app/components/tools/utils/to-form-schema'
import ToolPicker from '@/app/components/workflow/block-selector/tool-picker'
import { START_TAB_ID } from '@/app/components/workflow/skill/constants'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { $createToolBlockNode } from './node'
import { useToolBlockContext } from './tool-block-context'
import { $createToolGroupBlockNode } from './tool-group-block-node'

class ToolPickerMenuOption extends MenuOption {
  constructor() {
    super('tool-picker')
  }
}

type ToolPickerBlockProps = {
  scope?: string
  enableAutoDefault?: boolean
}

const ToolPickerBlock = ({ scope = 'all', enableAutoDefault = false }: ToolPickerBlockProps) => {
  const [editor] = useLexicalComposerContext()
  const checkForTriggerMatch = useBasicTypeaheadTriggerMatch('@', {
    minLength: 0,
    maxLength: 75,
  })
  const storeApi = useWorkflowStore()
  const { metadata, onMetadataChange } = useToolBlockContext(
    useShallow(context => ({
      metadata: context?.metadata,
      onMetadataChange: context?.onMetadataChange,
    })),
  )
  const isUsingExternalMetadata = Boolean(onMetadataChange)
  const [queryString, setQueryString] = useState('')

  const canUseAutoByType = useCallback(
    (type: string) => ![FormTypeEnum.modelSelector, FormTypeEnum.appSelector].includes(type as FormTypeEnum),
    [],
  )

  const options = useMemo(() => [new ToolPickerMenuOption()], [])

  const getMatchFromSelection = useCallback(() => {
    const selection = $getSelection()
    if (!$isRangeSelection(selection) || !selection.isCollapsed())
      return null
    const anchor = selection.anchor
    if (anchor.type !== 'text')
      return null
    const anchorNode = anchor.getNode()
    if (!anchorNode.isSimpleText())
      return null
    const text = anchorNode.getTextContent().slice(0, anchor.offset)
    return checkForTriggerMatch(text, editor)
  }, [checkForTriggerMatch, editor])

  const buildNextMetadata = useCallback((metadata: Record<string, unknown>, toolEntries: {
    configId: string
    tool: ToolDefaultValue
  }[]) => {
    const nextTools = { ...(metadata.tools || {}) } as Record<string, unknown>
    toolEntries.forEach(({ configId, tool }) => {
      const schemas = toolParametersToFormSchemas((tool.paramSchemas || []) as ToolParameter[])
      const fields = schemas.map(schema => ({
        id: schema.variable,
        value: schema.default ?? null,
        auto: enableAutoDefault ? canUseAutoByType(schema.type) : schema.form === 'llm',
      }))
      nextTools[configId] = {
        type: tool.provider_type,
        configuration: { fields },
      }
    })
    return {
      ...metadata,
      tools: nextTools,
    }
  }, [canUseAutoByType, enableAutoDefault])

  const insertTools = useCallback((tools: ToolDefaultValue[]) => {
    const toolEntries = tools.map(tool => ({
      configId: uuid(),
      tool,
    }))
    editor.update(() => {
      const match = getMatchFromSelection()
      const nodeToRemove = match ? $splitNodeContainingQuery(match) : null
      if (nodeToRemove)
        nodeToRemove.remove()

      const nodes: LexicalNode[] = []
      if (toolEntries.length > 1) {
        nodes.push($createToolGroupBlockNode({
          tools: toolEntries.map(({ tool, configId }) => ({
            provider: tool.provider_id,
            tool: tool.tool_name,
            configId,
          })),
        }))
      }
      else {
        toolEntries.forEach(({ tool, configId }, index) => {
          nodes.push(
            $createToolBlockNode({
              provider: tool.provider_id,
              tool: tool.tool_name,
              configId,
              label: tool.tool_label,
              icon: tool.provider_icon,
              iconDark: tool.provider_icon_dark,
            }),
          )
          if (index !== tools.length - 1)
            nodes.push($createTextNode(' '))
        })
      }

      if (nodes.length)
        $insertNodes(nodes)
    })

    if (isUsingExternalMetadata) {
      const externalMetadata = (metadata || {}) as Record<string, unknown>
      const nextMetadata = buildNextMetadata(externalMetadata, toolEntries)
      onMetadataChange?.(nextMetadata)
      return
    }
    const { activeTabId, fileMetadata, setDraftMetadata, pinTab } = storeApi.getState()
    if (!activeTabId || activeTabId === START_TAB_ID)
      return
    const currentMetadata = (fileMetadata.get(activeTabId) || {}) as Record<string, unknown>
    const nextMetadata = buildNextMetadata(currentMetadata, toolEntries)
    setDraftMetadata(activeTabId, {
      ...nextMetadata,
    })
    pinTab(activeTabId)
  }, [buildNextMetadata, editor, getMatchFromSelection, isUsingExternalMetadata, metadata, onMetadataChange, storeApi])

  const renderMenu = useCallback((
    anchorElementRef: React.RefObject<HTMLElement | null>,
    { selectOptionAndCleanUp }: { selectOptionAndCleanUp: (option: MenuOption) => void },
  ) => {
    if (!anchorElementRef.current)
      return null

    const closeMenu = () => {
      setQueryString('')
      selectOptionAndCleanUp(options[0])
    }

    return ReactDOM.createPortal(
      <ToolPicker
        disabled={false}
        trigger={(
          <span className="inline-block h-0 w-0" />
        )}
        triggerAsChild
        placement="bottom-start"
        offset={4}
        isShow
        onShowChange={(isShow) => {
          if (!isShow)
            closeMenu()
        }}
        onSelect={(tool) => {
          insertTools([tool])
          closeMenu()
        }}
        onSelectMultiple={(tools) => {
          insertTools(tools)
          closeMenu()
        }}
        searchText={queryString}
        onSearchTextChange={setQueryString}
        hideSearchBox
        enableKeyboardNavigation
        scope={scope}
        hideFeaturedTool
        preventFocusLoss
      />,
      anchorElementRef.current,
    )
  }, [insertTools, options, queryString, scope])

  return (
    <LexicalTypeaheadMenuPlugin
      options={options}
      onSelectOption={() => { }}
      onQueryChange={matchingString => setQueryString(matchingString || '')}
      menuRenderFn={renderMenu}
      triggerFn={checkForTriggerMatch}
      anchorClassName="z-[999999] translate-y-[calc(-100%-3px)]"
    />
  )
}

export default React.memo(ToolPickerBlock)
