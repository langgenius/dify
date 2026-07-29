'use client'

import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { useTranslation } from 'react-i18next'
import { MOCK_UNDEPLOYED_ENVIRONMENTS } from './mock-data'

type EnvironmentDeployMenuProps = {
  appearance?: 'empty' | 'header'
}

export function EnvironmentDeployMenu({ appearance = 'header' }: EnvironmentDeployMenuProps) {
  const { t } = useTranslation('deployments')
  const { t: tCommon } = useTranslation('common')
  const isEmptyState = appearance === 'empty'
  const label = isEmptyState
    ? t(($) => $['studio.deployToEnvironment'])
    : tCommon(($) => $['appMenus.deploy'])

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        render={
          <Button
            variant={isEmptyState ? 'secondary' : 'primary'}
            className="gap-0 px-2"
          >
            <span aria-hidden className="i-ri-add-line size-4" />
            <span className="pl-1.5">{label}</span>
            <span aria-hidden className="i-ri-arrow-down-s-line size-4" />
          </Button>
        }
      />
      <DropdownMenuContent
        placement="bottom-end"
        sideOffset={4}
        popupClassName="w-42 rounded-xl p-1"
      >
        <DropdownMenuGroup>
          <DropdownMenuLabel className="px-2 py-1 system-xs-medium-uppercase text-text-tertiary">
            {t(($) => $['card.notDeployed'])}
          </DropdownMenuLabel>
          {MOCK_UNDEPLOYED_ENVIRONMENTS.map((environment) => (
            <DropdownMenuItem key={environment} className="flex gap-2 px-2 py-1.5 mx-0">
              <span aria-hidden className="i-ri-instance-line size-4 text-text-tertiary shrink-0" />
              <span className="truncate system-md-regular text-text-secondary grow">{environment}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
