import { useTranslation } from 'react-i18next'

const i18nPrefix = 'dataset.metadata.checkName'

const useCheckMetadataName = () => {
  const { t } = useTranslation()
  return {
    checkName: (name: string) => {
      if (!name) {
        return {
          errorMsg: t(`${i18nPrefix}.empty`),
        }
      }

      if (!/^[a-z][a-z0-9_]*$/.test(name)) {
        return {
          errorMsg: t(`${i18nPrefix}.invalid`),
        }
      }

      if (name.length > 255) {
        return {
          errorMsg: t(`${i18nPrefix}.tooLong`, { max: 255 }),
        }
      }

      return {
        errorMsg: '',
      }
    },
  }
}

export default useCheckMetadataName
