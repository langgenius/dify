import copy from 'copy-to-clipboard'
import { useEffect, useState } from 'react'

export function useTokenClipboard() {
  const [copied, setCopied] = useState(false)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(timer)
  }, [copied])
  const reset = () => {
    setCopied(false)
    setFailed(false)
  }
  const copySecret = async (secret: string) => {
    reset()
    try {
      const succeeded = await copy(secret)
      setCopied(succeeded)
      setFailed(!succeeded)
    } catch {
      setFailed(true)
    }
  }
  return { copied, failed, reset, copySecret }
}
