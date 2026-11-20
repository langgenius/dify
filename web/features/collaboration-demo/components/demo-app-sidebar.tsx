'use client'

import { Separator } from '@langgenius/dify-ui/separator'
import { useTranslation } from 'react-i18next'
import AppInfoHeader from '@/app/components/app-sidebar/app-info/app-info-header'
import NavLink from '@/app/components/app-sidebar/nav-link'
import AccountSection from '@/app/components/main-nav/components/account-section'
import ContactSupport from '@/app/components/main-nav/components/contact-support'
import HelpMenu from '@/app/components/main-nav/components/help-menu'

function NavDivider() {
  return (
    <div className="px-1 py-0.5">
      <Separator orientation="horizontal" variant="solid" className="my-0 bg-divider-subtle" />
    </div>
  )
}

export function DemoAppSidebar() {
  const { t } = useTranslation(['common'])

  return (
    <div
      inert
      aria-hidden
      className="relative flex h-full w-16 min-w-0 shrink-0 bg-background-body p-1"
    >
      <div className="flex min-h-0 w-14 shrink-0 flex-col overflow-hidden rounded-lg bg-components-panel-bg">
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex w-full items-center justify-center px-3 pt-2 pb-1">
            <span className="flex size-8 items-center justify-center rounded-lg text-text-tertiary">
              <span className="i-custom-vender-line-arrows-sidebar-left-arrow size-4" />
            </span>
          </div>
          <div className="flex min-h-0 flex-1 flex-col pb-2">
            <div className="flex w-full shrink-0 justify-center px-3.5 pt-0.5 pb-0.75">
              <Separator
                decorative
                orientation="horizontal"
                variant="solid"
                className="my-0 w-6.75 bg-divider-subtle"
              />
            </div>
            <div className="px-1 py-2">
              <AppInfoHeader
                expand={false}
                appName=""
                operationGroups={[]}
                icon={{ icon_type: 'emoji', icon: '💬', icon_background: '#E0F2FE' }}
              />
            </div>
            <nav className="flex flex-col gap-y-0.5 px-3 py-1">
              <NavLink
                mode="collapse"
                active
                name={t(($) => $['appMenus.promptEng'], { ns: 'common' })}
                iconMap={{
                  selected: 'i-ri-terminal-window-fill',
                  normal: 'i-ri-terminal-window-line',
                }}
              />
              <NavLink
                mode="collapse"
                active={false}
                name={t(($) => $['appMenus.accessPoint'], { ns: 'common' })}
                iconMap={{
                  selected: 'i-custom-vender-agent-v2-access-point',
                  normal: 'i-custom-vender-agent-v2-access-point',
                }}
              />
              <NavDivider />
              <NavLink
                mode="collapse"
                active={false}
                name={t(($) => $['appMenus.logs'], { ns: 'common' })}
                iconMap={{ selected: 'i-ri-file-list-3-fill', normal: 'i-ri-file-list-3-line' }}
              />
              <NavLink
                mode="collapse"
                active={false}
                name={t(($) => $['appMenus.annotations'], { ns: 'common' })}
                iconMap={{
                  selected: 'i-custom-vender-line-general-annotations',
                  normal: 'i-custom-vender-line-general-annotations',
                }}
              />
              <NavDivider />
              <NavLink
                mode="collapse"
                active={false}
                name={t(($) => $['appMenus.overview'], { ns: 'common' })}
                iconMap={{ selected: 'i-ri-dashboard-2-fill', normal: 'i-ri-dashboard-2-line' }}
              />
            </nav>
          </div>
        </div>
        <ContactSupport placement="sidebar" compact />
        <div className="flex w-full shrink-0 flex-col items-center gap-0.5 rounded-lg px-2 pt-1 pb-3">
          <HelpMenu
            triggerIcon={<span aria-hidden className="i-ri-question-line size-4 shrink-0" />}
            triggerSize="lg"
            triggerClassName="mb-2"
          />
          <AccountSection compact />
        </div>
      </div>
    </div>
  )
}
