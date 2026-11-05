import type { MetadataShape } from '@/app/components/workflow/nodes/knowledge-retrieval/types'
import { Button } from '@langgenius/dify-ui/button'
import {
  Menu,
  MenuContent,
  MenuEmpty,
  MenuFilterProvider,
  MenuInput,
  MenuInputGroup,
  MenuItem,
  MenuList,
  MenuTrigger,
} from '@langgenius/dify-ui/menu'
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
    <MenuFilterProvider>
      <Menu>
        <MenuTrigger render={<Button size="small" variant="secondary" />}>
          <span aria-hidden="true" className="i-ri-add-line size-3.5" />
          {t(($) => $['nodes.knowledgeRetrieval.metadata.panel.add'], { ns: 'workflowModels' })}
        </MenuTrigger>
        <MenuContent align="start" sideOffset={12} className="w-80">
          <MenuInputGroup>
            <span
              aria-hidden="true"
              className="i-ri-search-line size-4 shrink-0 text-components-input-text-placeholder"
            />
            <MenuInput aria-label={searchLabel} placeholder={searchLabel} />
          </MenuInputGroup>
          <MenuEmpty>{t(($) => $.noData, { ns: 'common' })}</MenuEmpty>
          <MenuList>
            {metadataList?.map((metadata) => (
              <MenuItem
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
              </MenuItem>
            ))}
          </MenuList>
        </MenuContent>
      </Menu>
    </MenuFilterProvider>
  )
}

export default AddCondition
