import {
  memo,
} from 'react'
import { useStore } from '../../../../note-node/note-editor/store'
import LinkEditorComponent from '../../../../note-node/note-editor/plugins/link-editor-plugin/component'
import { useOpenLink } from '../../../../note-node/note-editor/plugins/link-editor-plugin/hooks'

type LinkEditorPluginProps = {
  containerElement: HTMLDivElement | null
}
const LinkEditorPlugin = ({
  containerElement,
}: LinkEditorPluginProps) => {
  useOpenLink()
  const linkAnchorElement = useStore(s => s.linkAnchorElement)

  if (!linkAnchorElement)
    return null

  return (
    <LinkEditorComponent containerElement={containerElement} />
  )
}

export default memo(LinkEditorPlugin)
