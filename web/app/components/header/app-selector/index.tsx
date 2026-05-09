'use client'
import type { AppDetailResponse } from '@/models/app'
import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { noop } from 'es-toolkit/function'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import CreateAppDialog from '@/app/components/app/create-app-dialog'
import AppIcon from '@/app/components/base/app-icon'
import { useAppContext } from '@/context/app-context'
import { useRouter } from '@/next/navigation'
import Indicator from '../indicator'

type IAppSelectorProps = {
  appItems: AppDetailResponse[]
  curApp: AppDetailResponse
}

export default function AppSelector({ appItems, curApp }: IAppSelectorProps) {
  const router = useRouter()
  const { isCurrentWorkspaceEditor } = useAppContext()
  const [showNewAppDialog, setShowNewAppDialog] = useState(false)
  const { t } = useTranslation()

  return (
    <div className="">
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger
          className={cn(
            'inline-flex h-7 w-full items-center justify-center rounded-[10px] pr-2.5 pl-2 text-[14px] font-semibold text-[#1C64F2] outline-hidden',
            'hover:bg-[#EBF5FF] focus-visible:bg-[#EBF5FF] focus-visible:ring-1 focus-visible:ring-components-input-border-hover data-popup-open:bg-[#EBF5FF]',
          )}
        >
          <span className="min-w-0 truncate">{curApp?.name}</span>
          <span
            className="ml-1 i-heroicons-chevron-down h-3 w-3 shrink-0"
            aria-hidden="true"
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          placement="bottom-end"
          sideOffset={6}
          popupClassName="w-60 max-w-80 divide-y divide-gray-100 bg-white p-0"
        >
          {!!appItems.length && (
            <div className="max-h-[50vh] overflow-auto px-1 py-1">
              {
                appItems.map((app: AppDetailResponse) => (
                  <DropdownMenuItem
                    key={app.id}
                    className="h-10 px-3 text-[14px] font-normal text-gray-700 hover:bg-gray-100 data-highlighted:bg-gray-100"
                    onClick={() =>
                      router.push(`/app/${app.id}/${isCurrentWorkspaceEditor ? 'configuration' : 'overview'}`)}
                  >
                    <div className="relative mr-2 h-6 w-6 shrink-0 rounded-md bg-[#D5F5F6]">
                      <AppIcon size="tiny" />
                      <div className="absolute -right-0.5 -bottom-0.5 flex h-2.5 w-2.5 items-center justify-center rounded-sm bg-white">
                        <Indicator />
                      </div>
                    </div>
                    <span className="min-w-0 truncate">{app.name}</span>
                  </DropdownMenuItem>
                ))
              }
            </div>
          )}
          {isCurrentWorkspaceEditor && (
            <div className="p-1">
              <DropdownMenuItem
                className="h-12 px-3 text-[14px] font-normal text-gray-700 hover:bg-gray-100 data-highlighted:bg-gray-100"
                onClick={() => setShowNewAppDialog(true)}
              >
                <div
                  className="
                    mr-2 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-[0.5px]
                    border-dashed border-gray-200 bg-gray-100
                  "
                >
                  <span className="i-heroicons-plus h-4 w-4 text-gray-500" />
                </div>
                <span>{t('menus.newApp', { ns: 'common' })}</span>
              </DropdownMenuItem>
            </div>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <CreateAppDialog
        show={showNewAppDialog}
        onClose={() => setShowNewAppDialog(false)}
        onSuccess={noop}
      />
    </div>
  )
}
