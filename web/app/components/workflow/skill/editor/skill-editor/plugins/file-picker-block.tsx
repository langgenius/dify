import type { LexicalNode } from 'lexical'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { LexicalTypeaheadMenuPlugin, MenuOption } from '@lexical/react/LexicalTypeaheadMenuPlugin'
import {
  $insertNodes,
} from 'lexical'
import * as React from 'react'
import { useCallback, useMemo } from 'react'
import { useBasicTypeaheadTriggerMatch } from '@/app/components/base/prompt-editor/hooks'
import { $splitNodeContainingQuery } from '@/app/components/base/prompt-editor/utils'
import {
  Popover,
  PopoverContent,
} from '@/app/components/base/ui/popover'
import { FilePickerPanel } from './file-picker-panel'
import { $createFileReferenceNode } from './file-reference-block/node'
import { useEditorBlur } from './hooks/use-editor-blur'

class FilePickerMenuOption extends MenuOption {
  constructor() {
    super('file-picker')
  }
}

const FilePickerBlock = () => {
  const [editor] = useLexicalComposerContext()
  const checkForTriggerMatch = useBasicTypeaheadTriggerMatch('/', {
    minLength: 0,
    maxLength: 0,
  })

  const options = useMemo(() => [new FilePickerMenuOption()], [])

  const { blurHidden } = useEditorBlur(editor)

  const insertFileReference = useCallback((resourceId: string) => {
    editor.update(() => {
      const match = checkForTriggerMatch('/', editor)
      const nodeToRemove = match ? $splitNodeContainingQuery(match) : null
      if (nodeToRemove)
        nodeToRemove.remove()

      const nodes: LexicalNode[] = [$createFileReferenceNode({ resourceId })]
      $insertNodes(nodes)
    })
  }, [checkForTriggerMatch, editor])

  const renderMenu = useCallback((
    anchorElementRef: React.RefObject<HTMLElement | null>,
    { selectOptionAndCleanUp }: { selectOptionAndCleanUp: (option: MenuOption) => void },
  ) => {
    if (blurHidden)
      return null
    if (!anchorElementRef.current)
      return null

    const closeMenu = () => selectOptionAndCleanUp(options[0])

    return (
      <Popover
        open
        onOpenChange={(open) => {
          if (!open)
            closeMenu()
        }}
      >
        <PopoverContent
          placement="bottom-start"
          sideOffset={4}
          popupClassName="rounded-none border-none bg-transparent shadow-none"
          positionerProps={{ anchor: anchorElementRef }}
          popupProps={{ initialFocus: false, finalFocus: false }}
        >
          <FilePickerPanel
            onSelectNode={(node) => {
              insertFileReference(node.id)
              closeMenu()
            }}
          />
        </PopoverContent>
      </Popover>
    )
  }, [blurHidden, insertFileReference, options])

  return (
    <LexicalTypeaheadMenuPlugin
      options={options}
      onSelectOption={() => { }}
      onQueryChange={() => { }}
      menuRenderFn={renderMenu}
      triggerFn={checkForTriggerMatch}
      anchorClassName="z-[999999] translate-y-[calc(-100%-3px)]"
    />
  )
}

export default React.memo(FilePickerBlock)
export { FilePickerPanel }
