import { useCallback, useState } from 'react'
import writeText from 'copy-to-clipboard'

type CopiedValue = string | null
type CopyFn = (text: string) => Promise<boolean>

function useCopyToClipboard(): [CopiedValue, CopyFn] {
  const [copiedText, setCopiedText] = useState<CopiedValue>(null)

  const copy: CopyFn = useCallback(async (text: string) => {
    writeText(text)
    setCopiedText(text)
    return true
  }, [])

  return [copiedText, copy]
}

export default useCopyToClipboard
