'use client'

import type { RequiredConnectionService } from '../connections/required-services'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import ConnectionServiceItem from '../connections/connection-service-item'

export default function ConnectionAuthCompletion({
  services,
  requester,
}: {
  services: readonly RequiredConnectionService[]
  requester: string
}) {
  const { t } = useTranslation(['share'])
  const accountsTitleId = useId()

  return (
    <>
      <div role="status" className="flex flex-col gap-2">
        <h2 className="flex items-center gap-2 title-3xl-semi-bold text-text-primary">
          <span
            aria-hidden="true"
            className="i-ri-checkbox-circle-fill size-5 shrink-0 text-text-success"
          />
          {t(($) => $['connections.headless.completeTitle'], { ns: 'share' })}
        </h2>
        <p className="system-md-regular text-text-secondary">
          {t(($) => $['connections.headless.completeDescription'], { ns: 'share' })}
        </p>
      </div>
      <div className="flex items-center gap-3 rounded-2xl border-[0.5px] border-components-panel-border-subtle bg-components-panel-on-panel-item-bg p-4">
        <span
          className="i-ri-message-3-line size-5 shrink-0 text-text-secondary"
          aria-hidden="true"
        />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className="system-md-semibold wrap-anywhere text-text-primary">
            {t(($) => $['connections.headless.continuesAutomatically'], {
              ns: 'share',
              source: requester,
            })}
          </p>
          <p className="system-xs-regular text-text-tertiary">
            {t(($) => $['connections.headless.closeWindow'], { ns: 'share' })}
          </p>
        </div>
      </div>
      <section aria-labelledby={accountsTitleId} className="flex flex-col gap-2">
        <h3 id={accountsTitleId} className="ps-1 system-xs-medium-uppercase text-text-tertiary">
          {t(($) => $['connections.headless.connectedAccounts'], { ns: 'share' })}
        </h3>
        <ul className="flex flex-col gap-2">
          {services.map((service) => {
            const selected = service.availableConnections.find(
              (connection) => connection.id === service.selectedConnectionId,
            )
            return (
              <ConnectionServiceItem
                key={service.id}
                icon={service.icon}
                iconDark={service.iconDark}
                iconClassName={service.iconClassName}
                name={service.name}
                description={service.description}
                renderControls={() => (
                  <span className="w-50 max-w-full px-3 py-2 text-end system-sm-regular wrap-anywhere text-text-secondary">
                    {selected?.name}
                  </span>
                )}
              />
            )
          })}
        </ul>
      </section>
    </>
  )
}
