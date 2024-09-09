import { useEffect, useRef, useState } from 'react'
import type { ModerationService } from '@/models/common'

function splitStringByLength(inputString: string, chunkLength: number) {
  const resultArray = []
  for (let i = 0; i < inputString.length; i += chunkLength)
    resultArray.push(inputString.substring(i, i + chunkLength))

  return resultArray
}

export const useModerate = (
  content: string,
  stop: boolean,
  moderationService: (text: string) => ReturnType<ModerationService>,
  separateLength = 50,
) => {
  const moderatedContentMap = useRef<Map<number, string>>(new Map())
  const moderatingIndex = useRef<number[]>([])
  const [contentArr, setContentArr] = useState<string[]>([])

  const handleModerate = () => {
    const stringArr = splitStringByLength(content, separateLength)

    const lastIndex = stringArr.length - 1
    stringArr.forEach((item, index) => {
      if (!(index in moderatingIndex.current) && !moderatedContentMap.current.get(index)) {
        if (index === lastIndex && !stop)
          return

        moderatingIndex.current.push(index)
        moderationService(item).then((res) => {
          if (res.flagged) {
            moderatedContentMap.current.set(index, res.text)
            setContentArr([...stringArr.slice(0, index), res.text, ...stringArr.slice(index + 1)])
          }
        })
      }
    })

    setContentArr(stringArr)
  }
  useEffect(() => {
    if (content)
      handleModerate()
  }, [content, stop])

  return contentArr.map((item, index) => moderatedContentMap.current.get(index) || item).join('')
}
