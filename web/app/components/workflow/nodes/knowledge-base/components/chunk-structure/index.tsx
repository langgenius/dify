import { memo } from 'react'
import { Field } from '@/app/components/workflow/nodes/_base/components/layout'
import type { ChunkStructureEnum } from '../../types'
import OptionCard from '../option-card'
import Selector from './selector'
import { useChunkStructure } from './hooks'

type ChunkStructureProps = {
  chunkStructure: ChunkStructureEnum
  onChunkStructureChange: (value: ChunkStructureEnum) => void
}
const ChunkStructure = ({
  chunkStructure,
  onChunkStructureChange,
}: ChunkStructureProps) => {
  const {
    options,
    optionMap,
  } = useChunkStructure()

  return (
    <Field
      fieldTitleProps={{
        title: 'Chunk Structure',
        tooltip: 'Chunk Structure',
        operation: (
          <Selector
            options={options}
            value={chunkStructure}
            onChange={onChunkStructureChange}
          />
        ),
      }}
    >
      <OptionCard {...optionMap[chunkStructure]} />
    </Field>
  )
}

export default memo(ChunkStructure)
