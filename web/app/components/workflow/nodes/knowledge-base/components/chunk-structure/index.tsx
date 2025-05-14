import { memo } from 'react'
import { Field } from '@/app/components/workflow/nodes/_base/components/layout'
import type { ChunkStructureEnum } from '../../types'
import OptionCard from '../option-card'
import Selector from './selector'
import { useChunkStructure } from './hooks'

type ChunkStructureProps = {
  chunkStructure: ChunkStructureEnum
  onChunkStructureChange: (value: ChunkStructureEnum) => void
  readonly?: boolean
}
const ChunkStructure = ({
  chunkStructure,
  onChunkStructureChange,
  readonly = false,
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
            readonly={readonly}
          />
        ),
      }}
    >
      <OptionCard {...optionMap[chunkStructure]} />
    </Field>
  )
}

export default memo(ChunkStructure)
