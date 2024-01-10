'use client'
import type { FC } from 'react'
import React from 'react'
import type { Collection, LOC, Tool } from '../types'
import Loading from '../../base/loading'
import Header from './header'

type Props = {
  collection: Collection | null
  list: Tool[]
  loc: LOC
}

const ToolList: FC<Props> = ({
  collection,
  list,
  loc,
}) => {
  if (!collection)
    return <Loading type='app' />

  return (
    <>
      <Header
        collection={collection}
        loc={loc}
      />
    </>
  )
}
export default React.memo(ToolList)
