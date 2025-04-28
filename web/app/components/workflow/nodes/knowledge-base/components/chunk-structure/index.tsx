import { Field } from '@/app/components/workflow/nodes/_base/components/layout'
import OptionCard from '../option-card'
import Selector from './selector'
import { useChunkStructure } from './hooks'

const ChunkStructure = () => {
  const {
    chunk,
    setChunk,
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
            value={chunk}
            onChange={setChunk}
          />
        ),
      }}
    >
      <OptionCard {...optionMap[chunk]} />
    </Field>
  )
}

export default ChunkStructure
