import { DataType } from '../types'
import { RiHashtag, RiTextSnippet, RiTimeLine } from '@remixicon/react'

export const getIcon = (type: DataType) => {
  return ({
    [DataType.string]: RiTextSnippet,
    [DataType.number]: RiHashtag,
    [DataType.time]: RiTimeLine,
  }[type] || RiTextSnippet)
}
