'use client'

import { useRef, useState } from 'react'

export function useDslFileReader() {
  const [dslFile, setDslFile] = useState<File>()
  const [dslContent, setDslContent] = useState('')
  const [isReadingDsl, setIsReadingDsl] = useState(false)
  const [dslReadError, setDslReadError] = useState(false)
  const dslReadTokenRef = useRef(0)

  function resetDslFileState() {
    dslReadTokenRef.current += 1
    setDslFile(undefined)
    setDslContent('')
    setIsReadingDsl(false)
    setDslReadError(false)
  }

  function selectDslFile(file?: File) {
    const readToken = dslReadTokenRef.current + 1
    dslReadTokenRef.current = readToken
    setDslFile(file)
    setDslContent('')
    setIsReadingDsl(false)
    setDslReadError(false)

    if (!file)
      return

    setIsReadingDsl(true)
    void file.text()
      .then((content) => {
        if (dslReadTokenRef.current !== readToken)
          return

        setDslContent(content)
      })
      .catch(() => {
        if (dslReadTokenRef.current !== readToken)
          return

        setDslReadError(true)
      })
      .finally(() => {
        if (dslReadTokenRef.current !== readToken)
          return

        setIsReadingDsl(false)
      })
  }

  return {
    dslContent,
    dslFile,
    dslReadError,
    isReadingDsl,
    resetDslFileState,
    selectDslFile,
  }
}
