import { RiArrowDownSLine, RiCheckLine } from '@remixicon/react'
import { useBoolean } from 'ahooks'
import * as React from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { PortalToFollowElem, PortalToFollowElemContent, PortalToFollowElemTrigger } from '@/app/components/base/portal-to-follow-elem'
import { cn } from '@/utils/classnames'

type VersionSelectorProps = {
  versionLen: number
  value: number
  onChange: (index: number) => void
}

const VersionSelector: React.FC<VersionSelectorProps> = ({ versionLen, value, onChange }) => {
  const { t } = useTranslation()
  const [isOpen, {
    setFalse: handleOpenFalse,
    toggle: handleOpenToggle,
    set: handleOpenSet,
  }] = useBoolean(false)

  const moreThanOneVersion = versionLen > 1
  const handleOpen = useCallback((value: boolean) => {
    if (moreThanOneVersion)
      handleOpenSet(value)
  }, [moreThanOneVersion, handleOpenToggle])
  const handleToggle = useCallback(() => {
    if (moreThanOneVersion)
      handleOpenToggle()
  }, [moreThanOneVersion, handleOpenToggle])

  const versions = Array.from({ length: versionLen }, (_, index) => ({
    label: `${t('generate.version', { ns: 'appDebug' })} ${index + 1}${index === versionLen - 1 ? ` · ${t('generate.latest', { ns: 'appDebug' })}` : ''}`,
    value: index,
  }))

  const isLatest = value === versionLen - 1

  return (
    <PortalToFollowElem
      placement="bottom-start"
      offset={{
        mainAxis: 4,
        crossAxis: -12,
      }}
      open={isOpen}
      onOpenChange={handleOpen}
    >
      <PortalToFollowElemTrigger
        onClick={handleToggle}
        asChild
      >

        <div className={cn('system-xs-medium flex items-center text-text-tertiary', isOpen && 'text-text-secondary', moreThanOneVersion && 'cursor-pointer')}>
          <div>
            {t('generate.version', { ns: 'appDebug' })}
            {' '}
            {value + 1}
            {isLatest && ` · ${t('generate.latest', { ns: 'appDebug' })}`}
          </div>
          {moreThanOneVersion && <RiArrowDownSLine className="size-3 " />}
        </div>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className={cn(
        'z-[99]',
      )}
      >
        <div
          className={cn(
            'w-[208px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-1 shadow-lg',
          )}
        >
          <div className={cn('system-xs-medium-uppercase flex h-[22px] items-center px-3 pl-3 text-text-tertiary')}>
            {t('generate.versions', { ns: 'appDebug' })}
          </div>
          {
            versions.map(option => (
              <div
                key={option.value}
                className={cn(
                  'system-sm-medium flex h-7 cursor-pointer items-center rounded-lg px-2 text-text-secondary hover:bg-state-base-hover',
                )}
                title={option.label}
                onClick={() => {
                  onChange(option.value)
                  handleOpenFalse()
                }}
              >
                <div className="mr-1 grow truncate px-1 pl-1">
                  {option.label}
                </div>
                {
                  value === option.value && <RiCheckLine className="h-4 w-4 shrink-0 text-text-accent" />
                }
              </div>
            ))
          }
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default VersionSelector
