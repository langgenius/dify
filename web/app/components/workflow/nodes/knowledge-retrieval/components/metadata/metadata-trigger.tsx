import type { MetadataShape } from '@/app/components/workflow/nodes/knowledge-retrieval/types'
import { Button } from '@langgenius/dify-ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { RiFilter3Line } from '@remixicon/react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { isMetadataConditionCompatible } from '../../metadata-schema'
import MetadataPanel from './metadata-panel'

const MetadataTrigger = ({
  metadataFilteringConditions,
  metadataList = [],
  handleRemoveCondition,
  selectedDatasetsLoaded,
  ...restProps
}: MetadataShape) => {
  const { t } = useTranslation(['workflowModels'])
  const [open, setOpen] = useState(false)
  const conditions = metadataFilteringConditions?.conditions || []

  const incompatible = selectedDatasetsLoaded
    ? conditions.filter((condition) => !isMetadataConditionCompatible(condition, metadataList))
    : []

  return (
    <div>
      {incompatible.length > 0 && !open && (
        <div role="alert" className="text-xs text-text-destructive">
          {t(($) => $['nodes.knowledgeRetrieval.metadata.conditionConflict'], {
            ns: 'workflowModels',
            fields: incompatible.map((condition) => condition.name).join(', '),
          })}
        </div>
      )}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button variant="secondary-accent" size="small">
              <RiFilter3Line className="size-3.5" />
              {t(($) => $['nodes.knowledgeRetrieval.metadata.panel.conditions'], {
                ns: 'workflowModels',
              })}
              <div className="flex items-center rounded-[5px] border border-divider-deep px-1 system-2xs-medium-uppercase text-text-tertiary">
                {metadataFilteringConditions?.conditions.length || 0}
              </div>
            </Button>
          }
        />
        <PopoverContent
          placement="left"
          sideOffset={4}
          className="border-none bg-transparent shadow-none"
        >
          <MetadataPanel
            selectedDatasetsLoaded={selectedDatasetsLoaded}
            metadataFilteringConditions={metadataFilteringConditions}
            onCancel={() => setOpen(false)}
            metadataList={metadataList}
            handleRemoveCondition={handleRemoveCondition}
            {...restProps}
          />
        </PopoverContent>
      </Popover>
    </div>
  )
}

export default MetadataTrigger
