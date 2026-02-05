'use client'
import { RiBookOpenLine, RiGithubLine } from '@remixicon/react'
import Link from 'next/link'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import { useDocLink } from '@/context/i18n'
import { cn } from '@/utils/classnames'

type DropdownItemProps = {
  href: string
  icon: React.ReactNode
  text: string
  onClick: () => void
}

const DropdownItem = ({ href, icon, text, onClick }: DropdownItemProps) => (
  <Link
    href={href}
    target="_blank"
    className="flex items-center gap-2 rounded-lg px-3 py-2 text-text-secondary hover:bg-state-base-hover hover:text-text-primary"
    onClick={onClick}
  >
    {icon}
    <span className="system-sm-medium">{text}</span>
  </Link>
)

const SubmitRequestDropdown = () => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const docLink = useDocLink()

  return (
    <PortalToFollowElem
      placement="bottom-start"
      offset={4}
      open={open}
      onOpenChange={setOpen}
    >
      <PortalToFollowElemTrigger onClick={() => setOpen(v => !v)}>
        <Button
          variant="ghost"
          className={cn(
            'flex items-center gap-1 px-3 py-2 text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary',
            open && 'bg-state-base-hover text-text-secondary',
          )}
        >
          <span className="system-sm-medium">
            {t('requestSubmitPlugin', { ns: 'plugin' })}
          </span>
          {/* <RiArrowDownSLine className={cn("h-4 w-4 transition-transform", open && "rotate-180")} /> */}
        </Button>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className="z-[1000]">
        <div className="min-w-[200px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-1 shadow-lg backdrop-blur-sm">
          <DropdownItem
            href="https://github.com/langgenius/dify-plugins/issues/new?template=plugin_request.yaml"
            icon={<RiGithubLine className="h-4 w-4 shrink-0" />}
            text={t('requestAPlugin', { ns: 'plugin' })}
            onClick={() => setOpen(false)}
          />
          <DropdownItem
            href={docLink('/develop-plugin/publishing/marketplace-listing/release-to-dify-marketplace')}
            icon={<RiBookOpenLine className="h-4 w-4 shrink-0" />}
            text={t('publishPlugins', { ns: 'plugin' })}
            onClick={() => setOpen(false)}
          />
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default SubmitRequestDropdown
