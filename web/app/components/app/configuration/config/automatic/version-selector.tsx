import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { RiArrowDownSLine, RiCheckLine } from '@remixicon/react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'

type VersionSelectorProps = {
  versionLen: number
  value: number
  onChange: (index: number) => void
}

const VersionSelector: React.FC<VersionSelectorProps> = ({ versionLen, value, onChange }) => {
  const { t } = useTranslation()
  const moreThanOneVersion = versionLen > 1
  const versions = Array.from({ length: versionLen }, (_, index) => ({
    label: `${t($ => $['generate.version'], { ns: 'appDebug' })} ${index + 1}${index === versionLen - 1 ? ` · ${t($ => $['generate.latest'], { ns: 'appDebug' })}` : ''}`,
    value: index,
  }))

  const isLatest = value === versionLen - 1

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={!moreThanOneVersion}
        className={cn(
          'flex items-center border-none bg-transparent p-0 system-xs-medium text-text-tertiary',
          moreThanOneVersion ? 'cursor-pointer data-popup-open:text-text-secondary' : 'cursor-default',
        )}
      >
        <div>
          {t($ => $['generate.version'], { ns: 'appDebug' })}
          {' '}
          {value + 1}
          {isLatest && ` · ${t($ => $['generate.latest'], { ns: 'appDebug' })}`}
        </div>
        {moreThanOneVersion && <RiArrowDownSLine className="size-3" />}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        placement="bottom-start"
        sideOffset={4}
        alignOffset={-12}
        popupClassName="w-[208px] rounded-xl border-[0.5px] bg-components-panel-bg-blur p-1"
      >
        <div className="flex h-[22px] items-center px-3 pl-3 system-xs-medium-uppercase text-text-tertiary">
          {t($ => $['generate.versions'], { ns: 'appDebug' })}
        </div>
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(nextValue) => {
            onChange(nextValue)
          }}
        >
          {versions.map(option => (
            <DropdownMenuRadioItem
              key={option.value}
              value={option.value}
              closeOnClick
              className="h-7 rounded-lg px-2 system-sm-medium text-text-secondary"
              title={option.label}
            >
              <div className="mr-1 grow truncate px-1 pl-1">
                {option.label}
              </div>
              {
                value === option.value && <RiCheckLine className="size-4 shrink-0 text-text-accent" />
              }
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export default VersionSelector
