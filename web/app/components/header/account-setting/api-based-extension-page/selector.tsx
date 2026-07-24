import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ACCOUNT_SETTING_TAB } from '@/app/components/header/account-setting/constants'
import { useIntegrationsSetting } from '@/app/components/header/account-setting/use-integrations-setting'
import { consoleQuery } from '@/service/client'
import { ApiBasedExtensionModal } from './modal'

type ApiBasedExtensionSelectorProps = {
  value: string
  onChange: (value: string) => void
}

export function ApiBasedExtensionSelector({ value, onChange }: ApiBasedExtensionSelectorProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [addModalOpen, setAddModalOpen] = useState(false)
  const openIntegrationsSetting = useIntegrationsSetting()
  const { data: apiBasedExtensions = [] } = useQuery(
    consoleQuery.apiBasedExtension.get.queryOptions(),
  )
  const handleSelect = (id: string) => {
    onChange(id)
    setOpen(false)
  }

  const currentItem = apiBasedExtensions.find((item) => item.id === value)

  const handleApiBasedExtensionSaved = () => {
    setAddModalOpen(false)
  }
  const handleAddModalOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) setAddModalOpen(false)
  }

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <button type="button" className="block w-full border-0 bg-transparent p-0 text-left">
              {currentItem ? (
                <div className="flex h-9 cursor-pointer items-center justify-between rounded-lg bg-components-input-bg-normal pr-2.5 pl-3">
                  <div className="text-sm text-text-primary">{currentItem.name}</div>
                  <div className="flex items-center">
                    <div className="mr-1.5 w-[270px] truncate text-right text-xs text-text-quaternary">
                      {currentItem.api_endpoint}
                    </div>
                    <span
                      className={`i-ri-arrow-down-s-line size-4 text-text-secondary ${!open && 'opacity-60'}`}
                      aria-hidden="true"
                    />
                  </div>
                </div>
              ) : (
                <div className="flex h-9 cursor-pointer items-center justify-between rounded-lg bg-components-input-bg-normal pr-2.5 pl-3 text-sm text-text-quaternary">
                  {t(($) => $['apiBasedExtension.selector.placeholder'], {
                    ns: 'common',
                  })}
                  <span
                    className={`i-ri-arrow-down-s-line h-4 w-4 text-text-secondary ${!open && 'opacity-60'}`}
                    aria-hidden="true"
                  />
                </div>
              )}
            </button>
          }
        />
        <PopoverContent
          placement="bottom-start"
          sideOffset={4}
          className="w-[calc(100%-32px)] max-w-[576px]"
          popupClassName="border-0 bg-transparent p-0 shadow-none backdrop-blur-none"
        >
          <div className="z-10 w-full rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-lg">
            <div className="p-1">
              <div className="flex items-center justify-between px-3 pt-2 pb-1">
                <div className="text-xs font-medium text-text-tertiary">
                  {t(($) => $['apiBasedExtension.selector.title'], { ns: 'common' })}
                </div>
                <button
                  type="button"
                  className="flex cursor-pointer items-center border-none bg-transparent p-0 text-xs text-text-accent"
                  onClick={() => {
                    setOpen(false)
                    openIntegrationsSetting({
                      payload: ACCOUNT_SETTING_TAB.API_BASED_EXTENSION,
                    })
                  }}
                >
                  {t(($) => $['apiBasedExtension.selector.manage'], { ns: 'common' })}
                  <span
                    className="ml-0.5 i-custom-vender-line-arrows-arrow-up-right size-3"
                    aria-hidden="true"
                  />
                </button>
              </div>
              <div className="max-h-[250px] overflow-y-auto">
                {apiBasedExtensions.map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    className="w-full cursor-pointer rounded-md border-none bg-transparent px-3 py-1.5 text-left hover:bg-state-base-hover"
                    onClick={() => handleSelect(item.id)}
                  >
                    <div className="text-sm text-text-primary">{item.name}</div>
                    <div className="text-xs text-text-tertiary">{item.api_endpoint}</div>
                  </button>
                ))}
              </div>
            </div>
            <div className="h-px bg-divider-regular" />
            <div className="p-1">
              <button
                type="button"
                className="flex h-8 w-full cursor-pointer items-center border-none bg-transparent px-3 text-left text-sm text-text-accent"
                onClick={() => {
                  setOpen(false)
                  setAddModalOpen(true)
                }}
              >
                <span className="mr-2 i-ri-add-line size-4" aria-hidden="true" />
                {t(($) => $['operation.add'], { ns: 'common' })}
              </button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
      {addModalOpen && (
        <ApiBasedExtensionModal
          open
          mode="create"
          onOpenChange={handleAddModalOpenChange}
          onSaved={handleApiBasedExtensionSaved}
        />
      )}
    </>
  )
}
