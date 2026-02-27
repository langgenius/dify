import {
  memo,
} from 'react'
import { useStore } from '../../store'
import LinkEditorComponent from './component'
import { useOpenLink } from './hooks'

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
