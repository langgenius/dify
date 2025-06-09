import { useQuery } from '@tanstack/react-query'
import { getAppAccessModeByAppCode } from './share'

const NAME_SPACE = 'webapp'

export const useAppAccessModeByCode = (code: string | null) => {
  return useQuery({
    queryKey: [NAME_SPACE, 'appAccessMode', code],
    queryFn: () => {
      if (!code)
        return null

      return getAppAccessModeByAppCode(code)
    },
    enabled: !!code,
  })
}
