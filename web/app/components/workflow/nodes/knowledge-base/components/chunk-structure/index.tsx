import type { ChunkStructureEnum } from '../../types'
import { RiAddLine } from '@remixicon/react'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import { Field } from '@/app/components/workflow/nodes/_base/components/layout'
import OptionCard from '../option-card'
import { useChunkStructure } from './hooks'
import Instruction from './instruction'
import Selector from './selector'

type ChunkStructureProps = {
  chunkStructure?: ChunkStructureEnum
  onChunkStructureChange: (value: ChunkStructureEnum) => void
  readonly?: boolean
}
const ChunkStructure = ({
  chunkStructure,
  onChunkStructureChange,
  readonly = false,
}: ChunkStructureProps) => {
  const { t } = useTranslation()
  const {
    options,
    optionMap,
  } = useChunkStructure()

  return (
    <Field
      fieldTitleProps={{
        title: t('nodes.knowledgeBase.chunkStructure', { ns: 'workflow' }),
        tooltip: t('nodes.knowledgeBase.chunkStructureTip.message', { ns: 'workflow' }),
        operation: chunkStructure && (
          <Selector
            options={options}
            value={chunkStructure}
            onChange={onChunkStructureChange}
            readonly={readonly}
          />
        ),
      }}
    >
      {
        !!chunkStructure && (
          <OptionCard
            {...optionMap[chunkStructure]}
            selectedId={chunkStructure}
            enableSelect={false}
            enableHighlightBorder={false}
          />
        )
      }
      {
        !chunkStructure && (
          <>
            <Selector
              options={options}
              onChange={onChunkStructureChange}
              readonly={readonly}
              trigger={(
                <Button
                  className="w-full"
                  variant="secondary-accent"
                >
                  <RiAddLine className="mr-1 h-4 w-4" />
                  {t('nodes.knowledgeBase.chooseChunkStructure', { ns: 'workflow' })}
                </Button>
              )}
            />
            <Instruction className="mt-2" />
          </>
        )
      }
    </Field>
  )
}

export default memo(ChunkStructure)
