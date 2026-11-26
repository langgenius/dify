import { DialogTrigger } from '@langgenius/dify-ui/dialog'
import { RiAddLine, RiArrowDownSLine } from '@remixicon/react'
import * as React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

type ApiItem = {
  value: string
  name: string
  url: string
}

type ExternalApiSelectProps = {
  'aria-labelledby'?: string
  items: ApiItem[]
  value?: string
  onSelect: (item: ApiItem) => void
}

const ExternalApiSelect: React.FC<ExternalApiSelectProps> = ({
  'aria-labelledby': ariaLabelledBy,
  items,
  value,
  onSelect,
}) => {
  const { t } = useTranslation(['dataset'])
  const [isOpen, setIsOpen] = useState(false)
  const selectedItem = items.find((item) => item.value === value)

  const handleSelect = (item: ApiItem) => {
    onSelect(item)
    setIsOpen(false)
  }

  return (
    <div className="relative w-full">
      <button
        type="button"
        aria-labelledby={ariaLabelledBy}
        className={`flex w-full cursor-pointer appearance-none items-center justify-between gap-0.5 self-stretch rounded-lg border-0 bg-components-input-bg-normal px-2 py-1 text-start hover:bg-state-base-hover-alt ${isOpen && 'bg-state-base-hover-alt'}`}
        onClick={() => setIsOpen(!isOpen)}
      >
        {selectedItem ? (
          <span className="flex items-center gap-2 self-stretch rounded-lg p-1">
            <span
              aria-hidden
              className="i-custom-vender-solid-development-api-connection-mod size-4 text-text-secondary"
            />
            <span className="flex grow items-center">
              <span className="overflow-hidden system-sm-regular text-ellipsis text-components-input-text-filled">
                {selectedItem.name}
              </span>
            </span>
          </span>
        ) : (
          <span className="system-sm-regular text-components-input-text-placeholder">
            {t(($) => $['selectExternalKnowledgeAPI.placeholder'], { ns: 'dataset' })}
          </span>
        )}
        <RiArrowDownSLine
          className={`size-4 text-text-quaternary transition-transform ${isOpen ? 'text-text-secondary' : ''}`}
        />
      </button>
      {isOpen && (
        <div className="absolute z-10 mt-1 w-full rounded-xl border border-components-panel-border bg-components-panel-bg-blur shadow-lg">
          {items.map((item) => (
            <button
              type="button"
              key={item.value}
              className="flex w-full cursor-pointer appearance-none items-center border-0 bg-transparent p-1 text-start"
              onClick={() => handleSelect(item)}
            >
              <span className="flex w-full items-center gap-2 self-stretch rounded-lg p-2 hover:bg-state-base-hover">
                <span
                  aria-hidden
                  className="i-custom-vender-solid-development-api-connection-mod size-4 text-text-secondary"
                />
                <span className="grow overflow-hidden system-sm-medium text-ellipsis text-text-secondary">
                  {item.name}
                </span>
                <span className="overflow-hidden text-end system-xs-regular text-ellipsis text-text-tertiary">
                  {item.url}
                </span>
              </span>
            </button>
          ))}
          <div className="flex flex-col items-start self-stretch p-1">
            <DialogTrigger
              render={
                <button
                  type="button"
                  className="flex w-full cursor-pointer appearance-none items-center gap-2 self-stretch rounded-lg border-0 bg-transparent p-2 text-start hover:bg-state-base-hover"
                />
              }
            >
              <RiAddLine className="size-4 text-text-secondary" />
              <span className="grow overflow-hidden system-sm-medium text-ellipsis text-text-secondary">
                {t(($) => $.createNewExternalAPI, { ns: 'dataset' })}
              </span>
            </DialogTrigger>
          </div>
        </div>
      )}
    </div>
  )
}

export default ExternalApiSelect
