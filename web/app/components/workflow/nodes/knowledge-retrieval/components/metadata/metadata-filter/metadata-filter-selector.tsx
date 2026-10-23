import { Button } from '@langgenius/dify-ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuRadioItemIndicator,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { useTranslation } from 'react-i18next'
import { MetadataFilteringModeEnum } from '@/app/components/workflow/nodes/knowledge-retrieval/types'

type MetadataFilterSelectorProps = {
  allowedModes?: readonly MetadataFilteringModeEnum[]
  value?: MetadataFilteringModeEnum
  onSelect: (value: MetadataFilteringModeEnum) => void
}
const MetadataFilterSelector = ({
  allowedModes,
  value = MetadataFilteringModeEnum.disabled,
  onSelect,
}: MetadataFilterSelectorProps) => {
  const { t } = useTranslation(['workflowModels'])
  const options = [
    {
      key: MetadataFilteringModeEnum.disabled,
      value: t(($) => $['nodes.knowledgeRetrieval.metadata.options.disabled.title'], {
        ns: 'workflowModels',
      }),
      desc: t(($) => $['nodes.knowledgeRetrieval.metadata.options.disabled.subTitle'], {
        ns: 'workflowModels',
      }),
    },
    {
      key: MetadataFilteringModeEnum.automatic,
      value: t(($) => $['nodes.knowledgeRetrieval.metadata.options.automatic.title'], {
        ns: 'workflowModels',
      }),
      desc: t(($) => $['nodes.knowledgeRetrieval.metadata.options.automatic.subTitle'], {
        ns: 'workflowModels',
      }),
    },
    {
      key: MetadataFilteringModeEnum.manual,
      value: t(($) => $['nodes.knowledgeRetrieval.metadata.options.manual.title'], {
        ns: 'workflowModels',
      }),
      desc: t(($) => $['nodes.knowledgeRetrieval.metadata.options.manual.subTitle'], {
        ns: 'workflowModels',
      }),
    },
  ]

  const visibleOptions = allowedModes
    ? options.filter((option) => allowedModes.includes(option.key))
    : options
  const selectedOption =
    visibleOptions.find((option) => option.key === value) ?? visibleOptions[0] ?? options[0]!

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="secondary" size="small" onClick={(e) => e.stopPropagation()} />}
      >
        {selectedOption.value}
        <span aria-hidden className="i-ri-arrow-down-s-line size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent placement="bottom-end" sideOffset={4} className="w-70 p-1">
        <DropdownMenuRadioGroup value={value} onValueChange={onSelect}>
          {visibleOptions.map((option) => (
            <DropdownMenuRadioItem
              key={option.key}
              value={option.key}
              closeOnClick
              className="h-auto items-start p-2 pr-3"
            >
              <div className="w-4 shrink-0">
                <DropdownMenuRadioItemIndicator />
              </div>
              <div className="grow">
                <div className="system-sm-semibold text-text-secondary">{option.value}</div>
                <div className="system-xs-regular text-text-tertiary">{option.desc}</div>
              </div>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export default MetadataFilterSelector
