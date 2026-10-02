import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroupLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuRadioItemIndicator,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { RiArrowDownSLine } from '@remixicon/react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'

type VersionSelectorProps = {
  versionLen: number
  value: number
  onChange: (index: number) => void
}

function VersionSelector({ versionLen, value, onChange }: VersionSelectorProps) {
  const { t } = useTranslation(['appGeneration'])
  const moreThanOneVersion = versionLen > 1
  const versions = Array.from({ length: versionLen }, (_, index) => ({
    label: `${t(($) => $['generate.version'], { ns: 'appGeneration' })} ${index + 1}${index === versionLen - 1 ? ` · ${t(($) => $['generate.latest'], { ns: 'appGeneration' })}` : ''}`,
    value: index,
  }))

  const isLatest = value === versionLen - 1

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={!moreThanOneVersion}
        className="flex cursor-pointer items-center border-none bg-transparent p-0 system-xs-medium text-text-tertiary data-disabled:cursor-default data-popup-open:text-text-secondary"
      >
        <div>
          {t(($) => $['generate.version'], { ns: 'appGeneration' })} {value + 1}
          {isLatest && ` · ${t(($) => $['generate.latest'], { ns: 'appGeneration' })}`}
        </div>
        {moreThanOneVersion && <RiArrowDownSLine className="size-3" />}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        placement="bottom-start"
        sideOffset={4}
        alignOffset={-12}
        className="w-52 p-1"
      >
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(nextValue) => {
            onChange(nextValue)
          }}
        >
          <DropdownMenuGroupLabel className="flex h-5.5 items-center py-0">
            {t(($) => $['generate.versions'], { ns: 'appGeneration' })}
          </DropdownMenuGroupLabel>
          {versions.map((option) => (
            <DropdownMenuRadioItem
              key={option.value}
              value={option.value}
              closeOnClick
              className="h-7 system-sm-medium text-text-secondary"
              title={option.label}
            >
              <div className="mr-1 grow truncate px-1">{option.label}</div>
              <DropdownMenuRadioItemIndicator />
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export default VersionSelector
