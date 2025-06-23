import type { RefObject } from 'react'
import { useEffect } from'react'
import {
  useStore,
} from 'reactflow'

type UseSelectionPasteProps = {
  workflowContainerRef: RefObject<HTMLDivElement>
}

export const useSelectionPaste = ({ workflowContainerRef }: UseSelectionPasteProps) => {
  const domNode = useStore(s => s.domNode)
  const handlePaste = (e: ClipboardEvent) => {
    e.preventDefault()
    console.log(e.clipboardData?.getData('text'))
  }

  useEffect(() => {
    if (domNode) {
      console.log('workflowContainerRef.current', domNode)
      domNode.addEventListener('paste', handlePaste)
    }
    return () => {
      if (domNode)
        domNode.removeEventListener('paste', handlePaste)
    }
  }, [domNode])
}
