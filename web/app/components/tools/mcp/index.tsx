'use client'
import React from 'react'

type Props = {
  searchText: string
}

const MCPList = ({
  searchText,
}: Props) => {
  return (
    <>
      <div>
        MCP
        {searchText}
      </div>
    </>
  )
}
export default MCPList
