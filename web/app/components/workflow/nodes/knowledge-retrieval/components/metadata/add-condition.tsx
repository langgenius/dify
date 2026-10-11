import type { MetadataShape } from '@/app/components/workflow/nodes/knowledge-retrieval/types'
import { Button } from '@langgenius/dify-ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuEmpty,
  DropdownMenuFilterProvider,
  DropdownMenuInput,
  DropdownMenuInputGroup,
  DropdownMenuItem,
  DropdownMenuList,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { useTranslation } from 'react-i18next'
import MetadataIcon from './metadata-icon'

const AddCondition = ({
  metadataList,
  handleAddCondition,
}: Pick<MetadataShape, 'handleAddCondition' | 'metadataList'>) => {
  const { t } = useTranslation(['common', 'workflowModels'])
  const searchLabel = t(($) => $['nodes.knowledgeRetrieval.metadata.panel.search'], {
    ns: 'workflowModels',
  })

  return (
    <DropdownMenuFilterProvider>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button size="small" variant="secondary" />}>
          <span aria-hidden="true" className="i-ri-add-line size-3.5" />
          {t(($) => $['nodes.knowledgeRetrieval.metadata.panel.add'], { ns: 'workflowModels' })}
        </DropdownMenuTrigger>
        <DropdownMenuContent placement="bottom-start" sideOffset={12} className="w-80">
          <DropdownMenuInputGroup>
            <span
              aria-hidden="true"
              className="i-ri-search-line size-4 shrink-0 text-components-input-text-placeholder"
            />
            <DropdownMenuInput aria-label={searchLabel} placeholder={searchLabel} />
          </DropdownMenuInputGroup>
          <DropdownMenuEmpty>{t(($) => $.noData, { ns: 'common' })}</DropdownMenuEmpty>
          <DropdownMenuList>
            {metadataList?.map((metadata) => (
              <DropdownMenuItem
                key={metadata.name}
                label={metadata.name}
                onClick={() => handleAddCondition?.(metadata)}
              >
                <MetadataIcon type={metadata.type} />
                <span className="grow truncate" title={metadata.name}>
                  {metadata.name}
                </span>
                <span className="shrink-0 system-xs-regular text-text-tertiary">
                  {metadata.type}
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuList>
        </DropdownMenuContent>
      </DropdownMenu>
    </DropdownMenuFilterProvider>
  )
}

export default AddCondition
