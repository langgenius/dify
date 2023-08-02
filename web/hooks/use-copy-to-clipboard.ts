import { useCallback, useState } from 'react'
import writeText from 'copy-to-clipboard'

type CopiedValue = string | null
type CopyFn = (text: string) => Promise<boolean>

function useCopyToClipboard(): [CopiedValue, CopyFn] {
  const [copiedText, setCopiedText] = useState<CopiedValue>(null)

  const copy: CopyFn = useCallback(async (text: string) => {
    try {
      writeText(text)
      setCopiedText(text)
      return true
    }
    catch (error) {
      console.warn('Copy failed', error)
      setCopiedText(null)
      return false
    }
  }, [])

  return [copiedText, copy]
}

export default useCopyToClipboard
