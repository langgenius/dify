import type { LexicalNode } from 'lexical'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { LexicalTypeaheadMenuPlugin, MenuOption } from '@lexical/react/LexicalTypeaheadMenuPlugin'
import {
  $insertNodes,
} from 'lexical'
import * as React from 'react'
import { useCallback, useMemo } from 'react'
import ReactDOM from 'react-dom'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import { useBasicTypeaheadTriggerMatch } from '@/app/components/base/prompt-editor/hooks'
import { $splitNodeContainingQuery } from '@/app/components/base/prompt-editor/utils'
import { FilePickerPanel } from './file-picker-panel'
import { $createFileReferenceNode } from './file-reference-block/node'

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
    if (!anchorElementRef.current)
      return null

    const closeMenu = () => selectOptionAndCleanUp(options[0])

    return ReactDOM.createPortal(
      <PortalToFollowElem
        open
        placement="bottom-start"
        offset={4}
        onOpenChange={(open) => {
          if (!open)
            closeMenu()
        }}
      >
        <PortalToFollowElemTrigger asChild>
          <span className="inline-block h-0 w-0" />
        </PortalToFollowElemTrigger>
        <PortalToFollowElemContent className="z-[1000]">
          <FilePickerPanel
            onSelectNode={(node) => {
              insertFileReference(node.id)
              closeMenu()
            }}
          />
        </PortalToFollowElemContent>
      </PortalToFollowElem>,
      anchorElementRef.current,
    )
  }, [insertFileReference, options])

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
