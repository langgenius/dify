'use client'
import { useMemo } from 'react'
import NewMCPCard from './create-card'
import { useAllMCPTools, useInvalidateAllMCPTools } from '@/service/use-tools'
import cn from '@/utils/classnames'

type Props = {
  searchText: string
}

const MCPList = ({
  searchText,
}: Props) => {
  const { data: list = [] } = useAllMCPTools()
  const invalidateMCPList = useInvalidateAllMCPTools()

  const filteredList = useMemo(() => {
    return list.filter((collection) => {
      if (searchText)
        return Object.values(collection.name).some(value => (value as string).toLowerCase().includes(searchText.toLowerCase()))
      return true
    })
  }, [list, searchText])

  function renderDefaultCard() {
    const defaultCards = Array.from({ length: 36 }, (_, index) => (
      <div
        key={index}
        className={cn(
          'inline-flex h-[108px] rounded-xl bg-background-default-lighter opacity-10',
          index < 4 && 'opacity-60',
          index >= 4 && index < 8 && 'opacity-50',
          index >= 8 && index < 12 && 'opacity-40',
          index >= 12 && index < 16 && 'opacity-30',
          index >= 16 && index < 20 && 'opacity-25',
          index >= 20 && index < 24 && 'opacity-20',
        )}
      ></div>
    ))
    return defaultCards
  }

  return (
    <>
      <div
        className={cn(
          'relative grid shrink-0 grid-cols-1 content-start gap-4 px-12 pb-4 pt-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4',
          !list.length && 'h-[calc(100vh_-_136px)] overflow-hidden',
        )}
      >
        <NewMCPCard handleCreate={invalidateMCPList} />
        {filteredList.map((item, index) => (
          <div key={index}></div>
        ))}
        {!list.length && renderDefaultCard()}
      </div>
    </>
  )
}
export default MCPList
