import type { LexicalNode } from 'lexical'
import type { Dispatch, SetStateAction } from 'react'
import {
  flip,
  offset,
  shift,
  useFloating,
} from '@floating-ui/react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { LexicalTypeaheadMenuPlugin, MenuOption } from '@lexical/react/LexicalTypeaheadMenuPlugin'
import {
  $insertNodes,
} from 'lexical'
import * as React from 'react'
import { useCallback, useLayoutEffect, useMemo } from 'react'
import ReactDOM from 'react-dom'
import { useBasicTypeaheadTriggerMatch } from '@/app/components/base/prompt-editor/hooks'
import { $splitNodeContainingQuery } from '@/app/components/base/prompt-editor/utils'
import { FilePickerPanel } from './file-picker-panel'
import { $createFileReferenceNode } from './file-reference-block/node'

class FilePickerMenuOption extends MenuOption {
  constructor() {
    super('file-picker')
  }
}

type ReferenceSyncProps = {
  anchor: HTMLElement | null
  setReference: Dispatch<SetStateAction<HTMLElement | null>> | ((node: HTMLElement | null) => void)
}

const ReferenceSync = ({ anchor, setReference }: ReferenceSyncProps) => {
  useLayoutEffect(() => {
    setReference(anchor)
  }, [anchor, setReference])

  return null
}

const FilePickerBlock = () => {
  const [editor] = useLexicalComposerContext()
  const { refs, floatingStyles, isPositioned } = useFloating({
    placement: 'bottom-start',
    middleware: [
      offset(0),
      shift({ padding: 8 }),
      flip(),
    ],
  })
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
      <>
        <ReferenceSync anchor={anchorElementRef.current} setReference={refs.setReference} />
        <div
          ref={refs.setFloating}
          style={{
            ...floatingStyles,
            visibility: isPositioned ? 'visible' : 'hidden',
          }}
          className="z-[1002] outline-none"
        >
          <FilePickerPanel
            onSelectNode={(node) => {
              insertFileReference(node.id)
              closeMenu()
            }}
          />
        </div>
      </>,
      anchorElementRef.current,
    )
  }, [floatingStyles, insertFileReference, isPositioned, options, refs])

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
