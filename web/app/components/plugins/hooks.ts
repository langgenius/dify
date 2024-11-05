import { useTranslation } from 'react-i18next'

export const useTags = () => {
  const { t } = useTranslation()

  return [
    {
      name: 'search',
      label: t('pluginTags.search'),
    },
    {
      name: 'image',
      label: t('pluginTags.image'),
    },
    {
      name: 'videos',
      label: t('pluginTags.videos'),
    },
    {
      name: 'weather',
      label: t('pluginTags.weather'),
    },
    {
      name: 'finance',
      label: t('pluginTags.finance'),
    },
    {
      name: 'design',
      label: t('pluginTags.design'),
    },
    {
      name: 'travel',
      label: t('pluginTags.travel'),
    },
    {
      name: 'social',
      label: t('pluginTags.social'),
    },
    {
      name: 'news',
      label: t('pluginTags.news'),
    },
    {
      name: 'medical',
      label: t('pluginTags.medical'),
    },
    {
      name: 'productivity',
      label: t('pluginTags.productivity'),
    },
    {
      name: 'education',
      label: t('pluginTags.education'),
    },
    {
      name: 'business',
      label: t('pluginTags.business'),
    },
    {
      name: 'entertainment',
      label: t('pluginTags.entertainment'),
    },
    {
      name: 'utilities',
      label: t('pluginTags.utilities'),
    },
    {
      name: 'other',
      label: t('pluginTags.other'),
    },
  ]
}
