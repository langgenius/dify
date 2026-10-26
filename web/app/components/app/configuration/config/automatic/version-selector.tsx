import {
  Menu,
  MenuContent,
  MenuGroupLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRadioItemIndicator,
  MenuTrigger,
} from '@langgenius/dify-ui/menu'
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
    <Menu>
      <MenuTrigger
        disabled={!moreThanOneVersion}
        className="flex cursor-pointer items-center border-none bg-transparent p-0 system-xs-medium text-text-tertiary data-disabled:cursor-default data-popup-open:text-text-secondary"
      >
        <div>
          {t(($) => $['generate.version'], { ns: 'appGeneration' })} {value + 1}
          {isLatest && ` · ${t(($) => $['generate.latest'], { ns: 'appGeneration' })}`}
        </div>
        {moreThanOneVersion && <RiArrowDownSLine className="size-3" />}
      </MenuTrigger>
      <MenuContent align="start" alignOffset={-12} className="w-52">
        <MenuRadioGroup
          value={value}
          onValueChange={(nextValue) => {
            onChange(nextValue)
          }}
        >
          <MenuGroupLabel className="flex h-5.5 items-center py-0">
            {t(($) => $['generate.versions'], { ns: 'appGeneration' })}
          </MenuGroupLabel>
          {versions.map((option) => (
            <MenuRadioItem
              key={option.value}
              value={option.value}
              closeOnClick
              className="h-7 system-sm-medium text-text-secondary"
              title={option.label}
            >
              <div className="mr-1 grow truncate px-1">{option.label}</div>
              <MenuRadioItemIndicator />
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuContent>
    </Menu>
  )
}

export default VersionSelector
