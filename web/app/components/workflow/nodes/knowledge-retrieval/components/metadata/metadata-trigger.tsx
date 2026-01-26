import type { MetadataShape } from '@/app/components/workflow/nodes/knowledge-retrieval/types'
import { RiFilter3Line } from '@remixicon/react'
import {
  useEffect,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import MetadataPanel from './metadata-panel'

const MetadataTrigger = ({
  metadataFilteringConditions,
  metadataList = [],
  handleRemoveCondition,
  selectedDatasetsLoaded,
  ...restProps
}: MetadataShape) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const conditions = metadataFilteringConditions?.conditions || []

  useEffect(() => {
    if (selectedDatasetsLoaded) {
      conditions.forEach((condition) => {
        // First try to match by metadata_id for reliable reference
        const foundById = condition.metadata_id && metadataList.find(metadata => metadata.id === condition.metadata_id)
        // Fallback to name matching only for backward compatibility with old conditions
        const foundByName = !condition.metadata_id && metadataList.find(metadata => metadata.name === condition.name)

        // Only remove condition if both metadata_id and name matching fail
        if (!foundById && !foundByName)
          handleRemoveCondition(condition.id)
      })
    }
  }, [metadataFilteringConditions, metadataList, handleRemoveCondition, selectedDatasetsLoaded])

  return (
    <PortalToFollowElem
      placement="left"
      offset={4}
      open={open}
      onOpenChange={setOpen}
    >
      <PortalToFollowElemTrigger onClick={() => setOpen(!open)}>
        <Button
          variant="secondary-accent"
          size="small"
        >
          <RiFilter3Line className="mr-1 h-3.5 w-3.5" />
          {t('nodes.knowledgeRetrieval.metadata.panel.conditions', { ns: 'workflow' })}
          <div className="system-2xs-medium-uppercase ml-1 flex items-center rounded-[5px] border border-divider-deep px-1 text-text-tertiary">
            {metadataFilteringConditions?.conditions.length || 0}
          </div>
        </Button>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className="z-10">
        <MetadataPanel
          metadataFilteringConditions={metadataFilteringConditions}
          onCancel={() => setOpen(false)}
          metadataList={metadataList}
          handleRemoveCondition={handleRemoveCondition}
          {...restProps}
        />
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default MetadataTrigger
