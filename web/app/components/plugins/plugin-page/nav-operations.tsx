'use client'

import type { ReactNode } from 'react'
import type { DocPathWithoutLang } from '@/types/doc-paths'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLinkItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { Fragment, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MARKETPLACE_URL_PREFIX } from '@/config'
import { useDocLink } from '@/context/i18n'

type DropdownItemProps = {
  href: string
  icon: ReactNode
  text: string
}

function DropdownItem({
  href,
  icon,
  text,
}: DropdownItemProps) {
  return (
    <DropdownMenuLinkItem
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="gap-2 rounded-lg px-3 py-2"
    >
      {icon}
      <span className="system-sm-medium text-text-secondary">{text}</span>
      <span className="ml-auto i-ri-arrow-right-up-line size-4 shrink-0 text-text-tertiary" />
    </DropdownMenuLinkItem>
  )
}

type OptionLabelKey = 'requestAPlugin' | 'pluginDevelopmentGuide' | 'pluginPublishGuide' | 'templatePublishingGuide'

function getOptions(docLink: (path: DocPathWithoutLang) => string): {
  href: string
  icon: ReactNode
  labelKey: OptionLabelKey
}[] {
  return [
    {
      href: 'https://github.com/langgenius/dify-plugins/issues/new?template=plugin_request.yaml',
      icon: <span className="i-ri-plug-line size-4 shrink-0 text-text-tertiary" />,
      labelKey: 'requestAPlugin',
    },
    {
      href: docLink('/develop-plugin/getting-started/getting-started-dify-plugin'),
      icon: <span className="i-ri-book-open-line size-4 shrink-0 text-text-tertiary" />,
      labelKey: 'pluginDevelopmentGuide',
    },
    {
      href: docLink('/develop-plugin/publishing/marketplace-listing/release-overview'),
      icon: <span className="i-ri-book-open-line size-4 shrink-0 text-text-tertiary" />,
      labelKey: 'pluginPublishGuide',
    },
    {
      href: MARKETPLACE_URL_PREFIX.replace('marketplace', 'creators'),
      icon: <span className="i-ri-book-open-line size-4 shrink-0 text-text-tertiary" />,
      labelKey: 'templatePublishingGuide',
    },
  ]
}

type SubmitRequestDropdownProps = {
  dividerAfterFirst?: boolean
}

export function SubmitRequestDropdown({
  dividerAfterFirst,
}: SubmitRequestDropdownProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const docLink = useDocLink()
  const options = getOptions(docLink)

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        render={(
          <Button
            aria-label={t($ => $.requestSubmit, { ns: 'plugin', defaultValue: t($ => $.requestAPlugin, { ns: 'plugin' }) })}
            variant="ghost"
            className={cn(
              'size-8 p-2 text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary',
              'data-popup-open:bg-state-base-hover data-popup-open:text-text-secondary',
            )}
          >
            <span className="i-ri-book-open-line size-4 shrink-0" />
          </Button>
        )}
      />
      <DropdownMenuContent
        placement="bottom-end"
        sideOffset={4}
        popupClassName="min-w-[200px] p-1"
      >
        {options.map((option, index) => (
          <Fragment key={option.href}>
            {dividerAfterFirst && index === 1 && (
              <DropdownMenuSeparator className="my-1" />
            )}
            <DropdownItem
              href={option.href}
              icon={option.icon}
              text={t($ => $[option.labelKey], { ns: 'plugin' })}
            />
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
