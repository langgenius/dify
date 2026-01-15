import type { LexicalNode } from 'lexical'
import type { FC } from 'react'
import type { ToolDefaultValue } from '@/app/components/workflow/block-selector/types'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { LexicalTypeaheadMenuPlugin, MenuOption } from '@lexical/react/LexicalTypeaheadMenuPlugin'
import {
  $createTextNode,
  $insertNodes,
} from 'lexical'
import * as React from 'react'
import { useCallback, useMemo } from 'react'
import ReactDOM from 'react-dom'
import { v4 as uuid } from 'uuid'
import { useBasicTypeaheadTriggerMatch } from '@/app/components/base/prompt-editor/hooks'
import { $splitNodeContainingQuery } from '@/app/components/base/prompt-editor/utils'
import ToolPicker from '@/app/components/workflow/block-selector/tool-picker'
import { $createToolBlockNode } from './node'

class ToolPickerMenuOption extends MenuOption {
  constructor() {
    super('tool-picker')
  }
}

type ToolPickerBlockProps = {
  scope?: string
}

const ToolPickerBlock: FC<ToolPickerBlockProps> = ({ scope = 'all' }) => {
  const [editor] = useLexicalComposerContext()
  const checkForTriggerMatch = useBasicTypeaheadTriggerMatch('@', {
    minLength: 0,
    maxLength: 0,
  })

  const options = useMemo(() => [new ToolPickerMenuOption()], [])

  const insertTools = useCallback((tools: ToolDefaultValue[]) => {
    editor.update(() => {
      const match = checkForTriggerMatch('@', editor)
      const nodeToRemove = match ? $splitNodeContainingQuery(match) : null
      if (nodeToRemove)
        nodeToRemove.remove()

      const nodes: LexicalNode[] = []
      tools.forEach((tool, index) => {
        nodes.push(
          $createToolBlockNode({
            provider: tool.provider_name,
            tool: tool.tool_name,
            configId: uuid(),
            label: tool.tool_label,
            icon: tool.provider_icon,
            iconDark: tool.provider_icon_dark,
          }),
        )
        if (index !== tools.length - 1)
          nodes.push($createTextNode(' '))
      })

      if (nodes.length)
        $insertNodes(nodes)
    })
  }, [checkForTriggerMatch, editor])

  const renderMenu = useCallback((
    anchorElementRef: React.RefObject<HTMLElement | null>,
    { selectOptionAndCleanUp }: { selectOptionAndCleanUp: (option: MenuOption) => void },
  ) => {
    if (!anchorElementRef.current)
      return null

    const closeMenu = () => selectOptionAndCleanUp(options[0])

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
        scope={scope}
      />,
      anchorElementRef.current,
    )
  }, [insertTools, options, scope])

  return (
    <LexicalTypeaheadMenuPlugin
      options={options}
      onSelectOption={() => {}}
      onQueryChange={() => {}}
      menuRenderFn={renderMenu}
      triggerFn={checkForTriggerMatch}
      anchorClassName="z-[999999] translate-y-[calc(-100%-3px)]"
    />
  )
}

export default React.memo(ToolPickerBlock)
