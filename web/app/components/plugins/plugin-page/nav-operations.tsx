'use client'
import type { DocPathWithoutLang } from '@/types/doc-paths'
import { RiAddLine, RiArrowRightUpLine, RiBookOpenLine } from '@remixicon/react'
import Link from 'next/link'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Badge from '@/app/components/base/badge'
import Button, { buttonVariants } from '@/app/components/base/button'
import { Playground, Plugin } from '@/app/components/base/icons/src/vender/plugin'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import { CREATION_TYPE } from '@/app/components/plugins/marketplace/search-params'
import { MARKETPLACE_URL_PREFIX } from '@/config'
import { useDocLink } from '@/context/i18n'
import { cn } from '@/utils/classnames'
import { useCreationType } from '../marketplace/atoms'

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
    <span className="system-sm-medium text-text-secondary">{text}</span>
    <RiArrowRightUpLine className="ml-auto h-4 w-4 shrink-0 text-text-tertiary" />
  </Link>
)

type OptionLabelKey = 'requestAPlugin' | 'publishPlugins' | 'createPublishTemplates'

const getOptions = (docLink: (path: DocPathWithoutLang) => string): { href: string, icon: React.ReactNode, labelKey: OptionLabelKey }[] => {
  return [
    {
      href: 'https://github.com/langgenius/dify-plugins/issues/new?template=plugin_request.yaml',
      icon: <Plugin className="h-4 w-4 shrink-0 text-text-tertiary" />,
      labelKey: 'requestAPlugin',
    },
    {
      href: docLink('/develop-plugin/publishing/marketplace-listing/release-to-dify-marketplace'),
      icon: <RiBookOpenLine className="h-4 w-4 shrink-0 text-text-tertiary" />,
      labelKey: 'publishPlugins',
    },
    {
      href: MARKETPLACE_URL_PREFIX.replace('marketplace', 'creators'),
      icon: <Playground className="h-4 w-4 shrink-0 text-text-tertiary" />,
      labelKey: 'createPublishTemplates',
    },
  ]
}

export const SubmitRequestDropdown = () => {
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
          <RiAddLine className="h-4 w-4 shrink-0 lg:hidden" />
          <span className="system-sm-medium hidden lg:inline">
            {t('requestSubmitPlugin', { ns: 'plugin' })}
          </span>
        </Button>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className="z-[1000]">
        <div className="min-w-[200px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-1 shadow-lg backdrop-blur-sm">
          {getOptions(docLink).map(option => (
            <DropdownItem
              key={option.href}
              href={option.href}
              icon={option.icon}
              text={t(option.labelKey, { ns: 'plugin' })}
              onClick={() => setOpen(false)}
            />
          ))}
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export const CreationTypeTabs = () => {
  const { t } = useTranslation()
  const creationType = useCreationType()

  return (
    <div className="flex items-center gap-1">
      <Link
        href={`/${CREATION_TYPE.plugins}`}
        className={cn(
          buttonVariants({ variant: 'ghost' }),
          'flex items-center gap-1 px-3 py-2 text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary',
          creationType === CREATION_TYPE.plugins && 'bg-state-base-hover text-text-secondary',
        )}
      >
        <Plugin className="h-4 w-4 shrink-0" />
        <span className="system-sm-medium hidden md:inline">
          {t('plugins', { ns: 'plugin' })}
        </span>
      </Link>
      <Link
        href={`/${CREATION_TYPE.templates}`}
        className={cn(
          buttonVariants({ variant: 'ghost' }),
          'flex items-center gap-1 px-3 py-2 text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary',
          creationType === CREATION_TYPE.templates && 'bg-state-base-hover text-text-secondary',
        )}
      >
        <Playground className="h-4 w-4 shrink-0" />
        <span className="system-sm-medium hidden md:inline">
          {t('templates', { ns: 'plugin' })}
        </span>
        <Badge className="ml-1 hidden h-4 rounded-[4px] border-none bg-saas-dify-blue-accessible px-1 text-[10px] font-bold leading-[14px] text-text-primary-on-surface md:inline-flex">
          {t('badge.new', { ns: 'plugin' })}
        </Badge>
      </Link>
    </div>
  )
}
