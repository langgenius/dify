import type { MetadataShape } from '@/app/components/workflow/nodes/knowledge-retrieval/types'
import type { MetadataInDoc } from '@/models/datasets'
import { Button } from '@langgenius/dify-ui/button'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@langgenius/dify-ui/input-group'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { RiAddLine } from '@remixicon/react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import MetadataIcon from './metadata-icon'

const AddCondition = ({
  metadataList,
  handleAddCondition,
}: Pick<MetadataShape, 'handleAddCondition' | 'metadataList'>) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [searchText, setSearchText] = useState('')
  const searchLabel = t(($) => $['nodes.knowledgeRetrieval.metadata.panel.search'], {
    ns: 'workflow',
  })

  const filteredMetadataList = useMemo(() => {
    return metadataList?.filter((metadata) => metadata.name.includes(searchText))
  }, [metadataList, searchText])

  const handleAddConditionWrapped = useCallback(
    (item: MetadataInDoc) => {
      handleAddCondition?.(item)
      setOpen(false)
    },
    [handleAddCondition],
  )

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button size="small" variant="secondary">
            <RiAddLine className="size-3.5" />
            {t(($) => $['nodes.knowledgeRetrieval.metadata.panel.add'], { ns: 'workflow' })}
          </Button>
        }
      />
      <PopoverContent
        placement="bottom-start"
        sideOffset={12}
        className="border-none bg-transparent p-0 shadow-none backdrop-blur-none"
      >
        <div className="w-[320px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg">
          <div className="p-2 pb-1">
            <InputGroup>
              <InputGroupInput
                type="search"
                aria-label={searchLabel}
                autoComplete="off"
                className="[&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none"
                placeholder={searchLabel}
                value={searchText}
                onValueChange={setSearchText}
              />
              <InputGroupAddon className="ps-2 pe-0.5">
                <span
                  aria-hidden="true"
                  className="i-ri-search-line size-4 text-components-input-text-placeholder"
                />
              </InputGroupAddon>
            </InputGroup>
          </div>
          <div className="p-1">
            {filteredMetadataList?.map((metadata) => (
              <button
                type="button"
                key={metadata.name}
                className="flex h-6 w-full cursor-pointer appearance-none items-center rounded-md border-none bg-transparent px-3 text-start system-sm-medium text-text-secondary outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid"
                onClick={() => handleAddConditionWrapped(metadata)}
              >
                <div className="mr-1 p-px">
                  <MetadataIcon type={metadata.type} />
                </div>
                <div className="grow truncate" title={metadata.name}>
                  {metadata.name}
                </div>
                <div className="shrink-0 system-xs-regular text-text-tertiary">{metadata.type}</div>
              </button>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

export default AddCondition
