'use client'
import type { FC } from 'react'
import { useQuery } from '@tanstack/react-query'
import { IS_DEV } from '@/config'

const defaultData = {
  stars: 110918,
}

const getStar = async () => {
  const res = await fetch('https://ungh.cc/repos/langgenius/dify')

  if (!res.ok)
    throw new Error('Failed to fetch github star')

  return res.json()
}

const GithubStar: FC<{ className: string }> = (props) => {
  const { isFetching, isError, data } = useQuery<{
    stars: number
  }>({
    queryKey: ['github-star'],
    queryFn: getStar,
    enabled: !IS_DEV,
    retry: false,
    placeholderData: defaultData,
  })

  if (isFetching)
    return <span className="i-ri-loader-2-line size-3 shrink-0 animate-spin text-text-tertiary" />

  if (isError)
    return <span {...props}>{defaultData.stars.toLocaleString()}</span>

  return <span {...props}>{data?.stars.toLocaleString()}</span>
}

export default GithubStar
