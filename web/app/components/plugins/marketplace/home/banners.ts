import type { PluginBanner } from '@dify/contracts/marketplace'
import { z } from 'zod'
import { marketplaceClient } from '@/service/client'

// The banner types live in @dify/contracts/marketplace so the standalone
// marketplace and the embedded console share one definition; this module owns
// the runtime normalization of the untyped delivery payload.
const MAX_CARDS_PER_PAGE = 4

// Mirrors the previous hand-rolled parsing: an optional field of the wrong
// type is dropped instead of rejecting the whole banner.
const lenientOptionalString = z.string().optional().catch(undefined)
// Same, but an empty string also collapses to undefined (responsive image
// variants are only useful when they actually point somewhere).
const lenientNonEmptyString = z.string().min(1).optional().catch(undefined)

const bannerBaseShape = {
  id: z.string().min(1),
  title: z.string().min(1),
  sort: z.number(),
  language: z.string().min(1),
}

const recommendCardSchema = z.object({
  item_type: z.enum(['plugin', 'template']),
  item_id: z.string().min(1),
  display_name: z.string().min(1),
  icon_url: lenientOptionalString,
  icon: lenientOptionalString,
  icon_background: lenientOptionalString,
  creator: lenientOptionalString,
  badges: z
    .unknown()
    .transform((value) =>
      Array.isArray(value)
        ? value.filter(
            (badge): badge is 'partner' | 'verified' => badge === 'partner' || badge === 'verified',
          )
        : undefined,
    )
    // The trailing optional keeps the key optional in the inferred type and
    // lets a missing field bypass the transform pipeline.
    .optional(),
  link: z.string().catch(''),
  card_position: z.number().catch(0),
})

const recommendContentSchema = z.object({
  theme_type: z.enum(['newest', 'hottest', 'partner']),
  heading: lenientOptionalString,
  subheadings: z
    .unknown()
    .transform((value) =>
      Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string')
        : undefined,
    )
    .optional(),
  description: lenientOptionalString,
  cards: z
    .array(recommendCardSchema.nullable().catch(null))
    .catch([])
    .transform((cards) =>
      cards
        .flatMap((card) => (card === null ? [] : [card]))
        .sort((a, b) => a.card_position - b.card_position)
        .slice(0, MAX_CARDS_PER_PAGE),
    )
    // A recommendation banner with no renderable card has nothing to show.
    .refine((cards) => cards.length > 0),
})

const blogContentSchema = z.object({
  blog_title: z.string().min(1),
  subtitle: lenientOptionalString,
  description: lenientOptionalString,
  link: z.string().min(1),
  link_target_type: z.enum(['blog', 'github']),
})

const imageContentShape = {
  images: z.object({
    desktop: z.string().min(1),
    tablet: lenientNonEmptyString,
    mobile: lenientNonEmptyString,
  }),
  link: z.string().min(1),
  alt_text: lenientOptionalString,
  activity_id: lenientOptionalString,
}

const pluginBannerSchema = z.discriminatedUnion('style_type', [
  z.object({
    ...bannerBaseShape,
    style_type: z.literal('recommend'),
    content: recommendContentSchema,
  }),
  z.object({
    ...bannerBaseShape,
    style_type: z.literal('blog'),
    content: blogContentSchema,
  }),
  z.object({
    ...bannerBaseShape,
    style_type: z.literal('event'),
    content: z.object(imageContentShape),
  }),
  z.object({
    ...bannerBaseShape,
    style_type: z.literal('ad'),
    content: z.object({
      ...imageContentShape,
      partner_id: lenientOptionalString,
      campaign_id: lenientOptionalString,
    }),
  }),
])

const bannersResponseSchema = z.object({
  data: z.object({
    banners: z.array(z.unknown()),
  }),
})

const normalizePluginBanners = (response: unknown): PluginBanner[] => {
  const parsedResponse = bannersResponseSchema.safeParse(response)
  if (!parsedResponse.success) return []

  return parsedResponse.data.data.banners
    .flatMap((banner): PluginBanner[] => {
      // Malformed banners are dropped individually so one bad delivery entry
      // does not blank the whole trending section.
      const parsedBanner = pluginBannerSchema.safeParse(banner)
      return parsedBanner.success ? [parsedBanner.data] : []
    })
    .sort((a, b) => a.sort - b.sort)
}

export const fetchPluginBanners = async (language: string): Promise<PluginBanner[]> => {
  const response = await marketplaceClient.banners.list({
    query: {
      page: 'plugins',
      language,
    },
  })

  return normalizePluginBanners(response)
}
