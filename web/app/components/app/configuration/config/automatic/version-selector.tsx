import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { RiArrowDownSLine, RiCheckLine } from '@remixicon/react'
import { useBoolean } from 'ahooks'
import * as React from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

type VersionSelectorProps = {
  versionLen: number
  value: number
  onChange: (index: number) => void
}

const VersionSelector: React.FC<VersionSelectorProps> = ({ versionLen, value, onChange }) => {
  const { t } = useTranslation()
  const [isOpen, {
    setFalse: handleOpenFalse,
    set: handleOpenSet,
  }] = useBoolean(false)

  const moreThanOneVersion = versionLen > 1
  const handleOpen = useCallback((nextOpen: boolean) => {
    if (moreThanOneVersion)
      handleOpenSet(nextOpen)
  }, [moreThanOneVersion, handleOpenSet])

  const versions = Array.from({ length: versionLen }, (_, index) => ({
    label: `${t('generate.version', { ns: 'appDebug' })} ${index + 1}${index === versionLen - 1 ? ` · ${t('generate.latest', { ns: 'appDebug' })}` : ''}`,
    value: index,
  }))

  const isLatest = value === versionLen - 1

  return (
    <DropdownMenu
      open={isOpen}
      onOpenChange={handleOpen}
    >
      <DropdownMenuTrigger
        nativeButton={false}
        render={(
          <div className={cn('flex items-center system-xs-medium text-text-tertiary', isOpen && 'text-text-secondary', moreThanOneVersion && 'cursor-pointer')} />
        )}
      >
        <div>
          {t('generate.version', { ns: 'appDebug' })}
          {' '}
          {value + 1}
          {isLatest && ` · ${t('generate.latest', { ns: 'appDebug' })}`}
        </div>
        {moreThanOneVersion && <RiArrowDownSLine className="size-3" />}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        placement="bottom-start"
        sideOffset={4}
        alignOffset={-12}
        popupClassName="w-[208px] rounded-xl border-[0.5px] bg-components-panel-bg-blur p-1"
      >
        <div className={cn('flex h-[22px] items-center px-3 pl-3 system-xs-medium-uppercase text-text-tertiary')}>
          {t('generate.versions', { ns: 'appDebug' })}
        </div>
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(nextValue) => {
            onChange(nextValue)
            handleOpenFalse()
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
                value === option.value && <RiCheckLine className="h-4 w-4 shrink-0 text-text-accent" />
              }
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export default VersionSelector
