import type { ChunkingMode } from '@/models/datasets'
import * as React from 'react'
import OptionCard from '../option-card'
import { useChunkStructure } from './hooks'

type ChunkStructureProps = {
  chunkStructure: ChunkingMode
}

const ChunkStructure = ({
  chunkStructure,
}: ChunkStructureProps) => {
  const {
    options,
  } = useChunkStructure()

  return (
    <div className="flex flex-col gap-y-1">
      {
        options.map(option => (
          <OptionCard
            key={option.id}
            id={option.id}
            icon={option.icon}
            iconActiveColor={option.iconActiveColor}
            title={option.title}
            description={option.description}
            isActive={chunkStructure === option.id}
            effectColor={option.effectColor}
            showEffectColor
            className="gap-x-1.5 p-3 pr-4"
            disabled
          />
        ))
      }
    </div>
  )
}

export default React.memo(ChunkStructure)
