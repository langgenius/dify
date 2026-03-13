import {
  RiArrowDownSLine,
  RiCheckLine,
} from '@remixicon/react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
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
  const [open, setOpen] = useState(false)
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
    <PortalToFollowElem
      placement="bottom-end"
      offset={{
        mainAxis: 4,
        crossAxis: 0,
      }}
      open={open}
      onOpenChange={setOpen}
    >
      <PortalToFollowElemTrigger
        onClick={(e) => {
          e.stopPropagation()
          setOpen(!open)
        }}
        asChild
      >
        <Button
          variant="secondary"
          size="small"
        >
          {selectedOption.value}
          <RiArrowDownSLine className="h-3.5 w-3.5" />
        </Button>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className="z-10">
        <div className="w-[280px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-1 shadow-lg">
          {
            options.map(option => (
              <div
                key={option.key}
                className="flex cursor-pointer rounded-lg p-2 pr-3 hover:bg-state-base-hover"
                onClick={() => {
                  onSelect(option.key)
                  setOpen(false)
                }}
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
              </div>
            ))
          }
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default MetadataFilterSelector
