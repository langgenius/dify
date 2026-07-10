import { useTranslation } from 'react-i18next'

export const ValidatingTip = () => {
  const { t } = useTranslation()
  return (
    <div className="mt-2 text-xs font-normal text-primary-600">
      {t($ => $['provider.validating'], { ns: 'common' })}
    </div>
  )
}
