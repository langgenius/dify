import { Button } from '@langgenius/dify-ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import {
  RiArrowDownSLine,
  RiCheckLine,
} from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import { MetadataFilteringModeEnum } from '@/app/components/workflow/nodes/knowledge-retrieval/types'

type MetadataFilterSelectorProps = {
  value?: MetadataFilteringModeEnum
  onSelect: (value: MetadataFilteringModeEnum) => void
}
const MetadataFilterSelector = ({
  value = MetadataFilteringModeEnum.disabled,
  onSelect,
}: MetadataFilterSelectorProps) => {
  const { t } = useTranslation()
  const options = [
    {
      key: MetadataFilteringModeEnum.disabled,
      value: t('nodes.knowledgeRetrieval.metadata.options.disabled.title', { ns: 'workflow' }),
      desc: t('nodes.knowledgeRetrieval.metadata.options.disabled.subTitle', { ns: 'workflow' }),
    },
    {
      key: MetadataFilteringModeEnum.automatic,
      value: t('nodes.knowledgeRetrieval.metadata.options.automatic.title', { ns: 'workflow' }),
      desc: t('nodes.knowledgeRetrieval.metadata.options.automatic.subTitle', { ns: 'workflow' }),
    },
    {
      key: MetadataFilteringModeEnum.manual,
      value: t('nodes.knowledgeRetrieval.metadata.options.manual.title', { ns: 'workflow' }),
      desc: t('nodes.knowledgeRetrieval.metadata.options.manual.subTitle', { ns: 'workflow' }),
    },
  ]

  const selectedOption = options.find(option => option.key === value)!

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={(
          <Button
            variant="secondary"
            size="small"
            onClick={e => e.stopPropagation()}
          />
        )}
      >
        {selectedOption.value}
        <RiArrowDownSLine className="h-3.5 w-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        placement="bottom-end"
        sideOffset={4}
        popupClassName="w-[280px] rounded-xl border-[0.5px] bg-components-panel-bg-blur p-1"
      >
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={onSelect}
        >
          {
            options.map(option => (
              <DropdownMenuRadioItem
                key={option.key}
                value={option.key}
                closeOnClick
                className="h-auto items-start rounded-lg p-2 pr-3"
              >
                <div className="w-4 shrink-0">
                  {
                    option.key === value && (
                      <RiCheckLine className="h-4 w-4 text-text-accent" />
                    )
                  }
                </div>
                <div className="grow">
                  <div className="system-sm-semibold text-text-secondary">
                    {option.value}
                  </div>
                  <div className="system-xs-regular text-text-tertiary">
                    {option.desc}
                  </div>
                </div>
              </DropdownMenuRadioItem>
            ))
          }
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export default MetadataFilterSelector
