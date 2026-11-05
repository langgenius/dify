'use client'

import { AutocompleteStatus } from '@langgenius/dify-ui/autocomplete'
import { useTranslation } from 'react-i18next'

type SearchAnnouncementsProps = {
  hintId: string
  status: string | null
  describesTokenRemoval: boolean
}

export function SearchAnnouncements({
  hintId,
  status,
  describesTokenRemoval,
}: SearchAnnouncementsProps) {
  const { t } = useTranslation(['app'])

  return (
    <>
      <p id={hintId} className="sr-only">
        {t(($) => $['gotoAnything.searchHint'], { ns: 'app' })}
        {describesTokenRemoval && (
          <> {t(($) => $['gotoAnything.contextTokenHint'], { ns: 'app' })}</>
        )}
      </p>
      <AutocompleteStatus className="sr-only">{status}</AutocompleteStatus>
    </>
  )
}
