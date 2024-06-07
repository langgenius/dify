import { memo } from 'react'
import LinkEditorComponent from './component'

type LinkEditorPluginProps = {
  containerElement: HTMLDivElement | null
}
const LinkEditorPlugin = ({
  containerElement,
}: LinkEditorPluginProps) => {
  return (
    <LinkEditorComponent containerElement={containerElement} />
  )
}

export default memo(LinkEditorPlugin)
