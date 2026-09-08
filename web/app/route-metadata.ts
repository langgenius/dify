import type { SelectorParam } from 'i18next'
import type { Namespace } from '@/i18n-config/resources'
import type { Metadata } from '@/next'
import { getLocaleOnServer, getTranslation } from '@/i18n-config/server'
import 'server-only'

export async function getRouteMetadata<T extends Namespace>(
  namespace: T,
  selector: SelectorParam<T>,
): Promise<Metadata> {
  const locale = await getLocaleOnServer()
  const { t } = await getTranslation(locale, namespace)

  return { title: t(selector, { ns: namespace }) }
}
