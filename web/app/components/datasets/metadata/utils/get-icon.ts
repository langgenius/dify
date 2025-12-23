import { RiHashtag, RiTextSnippet, RiTimeLine } from '@remixicon/react'
import { DataType } from '../types'

export const getIcon = (type: DataType) => {
  return ({
    [DataType.string]: RiTextSnippet,
    [DataType.number]: RiHashtag,
    [DataType.time]: RiTimeLine,
  }[type] || RiTextSnippet)
}
