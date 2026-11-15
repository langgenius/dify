import { Button } from '@langgenius/dify-ui/button'
import {
  Menu,
  MenuContent,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRadioItemIndicator,
  MenuTrigger,
} from '@langgenius/dify-ui/menu'
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
    <Menu>
      <MenuTrigger
        render={<Button variant="secondary" size="small" onClick={(e) => e.stopPropagation()} />}
      >
        {selectedOption.value}
        <span aria-hidden className="i-ri-arrow-down-s-line size-3.5" />
      </MenuTrigger>
      <MenuContent className="w-70">
        <MenuRadioGroup value={value} onValueChange={onSelect}>
          {visibleOptions.map((option) => (
            <MenuRadioItem
              key={option.key}
              value={option.key}
              closeOnClick
              className="h-auto items-start p-2 pr-3"
            >
              <div className="w-4 shrink-0">
                <MenuRadioItemIndicator />
              </div>
              <div className="grow">
                <div className="system-sm-semibold text-text-secondary">{option.value}</div>
                <div className="system-xs-regular text-text-tertiary">{option.desc}</div>
              </div>
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuContent>
    </Menu>
  )
}

export default MetadataFilterSelector
