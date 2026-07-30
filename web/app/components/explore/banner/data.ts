import type {
  BannerListResponse,
  BannerResponse,
} from '@dify/contracts/api/console/explore/types.gen'
import type { Banner } from '@/models/app'
import { getLocaleOnServer } from '@/i18n-config/server'
import { getServerConsoleClientContext, serverConsoleClient } from '@/service/server'
import 'server-only'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const getStringProperty = (source: object, key: string, fallback = '') => {
  const value: unknown = Reflect.get(source, key)
  return typeof value === 'string' ? value : fallback
}

const normalizeBannerContent = (content: unknown): Banner['content'] => {
  const record = isRecord(content) ? content : {}

  return {
    category: getStringProperty(record, 'category'),
    title: getStringProperty(record, 'title'),
    description: getStringProperty(record, 'description'),
    'img-src': getStringProperty(record, 'img-src'),
  }
}

const normalizeBanner = (banner: BannerResponse): Banner => ({
  id: banner.id,
  content: normalizeBannerContent(banner.content),
  link: banner.link ?? '',
  sort: banner.sort,
  status: banner.status,
  created_at: banner.created_at ?? '',
})

const normalizeBannersResponse = (response: BannerListResponse): Banner[] =>
  response.map(normalizeBanner)

export async function getHomeBanners(): Promise<Banner[]> {
  const [language, context] = await Promise.all([
    getLocaleOnServer(),
    getServerConsoleClientContext(),
  ])
  const response = await serverConsoleClient.explore.banners.get(
    {
      query: { language },
    },
    { context },
  )

  return normalizeBannersResponse(response)
}
