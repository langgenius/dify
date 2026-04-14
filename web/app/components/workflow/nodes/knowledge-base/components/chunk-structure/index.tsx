import type { ChunkStructureEnum } from '../../types'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/app/components/base/ui/button'
import { Field } from '@/app/components/workflow/nodes/_base/components/layout'
import OptionCard from '../option-card'
import { useChunkStructure } from './hooks'
import Instruction from './instruction'
import Selector from './selector'

type ChunkStructureProps = {
  chunkStructure?: ChunkStructureEnum
  onChunkStructureChange: (value: ChunkStructureEnum) => void
  warningDot?: boolean
  readonly?: boolean
}
const ChunkStructure = ({
  chunkStructure,
  onChunkStructureChange,
  warningDot = false,
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
        warningDot,
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
                  <span className="mr-1 i-ri-add-line h-4 w-4" />
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
