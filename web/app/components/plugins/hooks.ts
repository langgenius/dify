import { useTranslation } from 'react-i18next'

type Tag = {
  name: string
  label: string
}

export const useTags = () => {
  const { t } = useTranslation()

  const tags = [
    {
      name: 'search',
      label: t('pluginTags.tags.search'),
    },
    {
      name: 'image',
      label: t('pluginTags.tags.image'),
    },
    {
      name: 'videos',
      label: t('pluginTags.tags.videos'),
    },
    {
      name: 'weather',
      label: t('pluginTags.tags.weather'),
    },
    {
      name: 'finance',
      label: t('pluginTags.tags.finance'),
    },
    {
      name: 'design',
      label: t('pluginTags.tags.design'),
    },
    {
      name: 'travel',
      label: t('pluginTags.tags.travel'),
    },
    {
      name: 'social',
      label: t('pluginTags.tags.social'),
    },
    {
      name: 'news',
      label: t('pluginTags.tags.news'),
    },
    {
      name: 'medical',
      label: t('pluginTags.tags.medical'),
    },
    {
      name: 'productivity',
      label: t('pluginTags.tags.productivity'),
    },
    {
      name: 'education',
      label: t('pluginTags.tags.education'),
    },
    {
      name: 'business',
      label: t('pluginTags.tags.business'),
    },
    {
      name: 'entertainment',
      label: t('pluginTags.tags.entertainment'),
    },
    {
      name: 'utilities',
      label: t('pluginTags.tags.utilities'),
    },
    {
      name: 'other',
      label: t('pluginTags.tags.other'),
    },
  ]

  const tagsMap = tags.reduce((acc, tag) => {
    acc[tag.name] = tag
    return acc
  }, {} as Record<string, Tag>)

  return {
    tags,
    tagsMap,
  }
}
