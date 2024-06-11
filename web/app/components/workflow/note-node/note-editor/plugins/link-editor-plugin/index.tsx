import {
  memo,
} from 'react'
import { useOpenLink } from './hooks'
import LinkEditorComponent from './component'

type LinkEditorPluginProps = {
  containerElement: HTMLDivElement | null
}
const LinkEditorPlugin = ({
  containerElement,
}: LinkEditorPluginProps) => {
  useOpenLink()

  return (
    <LinkEditorComponent containerElement={containerElement} />
  )
}

export default memo(LinkEditorPlugin)
