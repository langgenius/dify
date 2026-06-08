'use client'
import type { FC } from 'react'
import { useQuery } from '@tanstack/react-query'

type GithubStarResponse = {
  repo: {
    stars: number
  }
}

const defaultData: GithubStarResponse = {
  repo: { stars: 110918 },
}

const getStar = async () => {
  const res = await fetch('https://ungh.cc/repos/langgenius/dify')

  if (!res.ok)
    throw new Error('Failed to fetch github star')

  return res.json()
}

const GithubStar: FC<{ className: string }> = (props) => {
  const { isFetching, isError, data } = useQuery<GithubStarResponse>({
    queryKey: ['github-star'],
    queryFn: getStar,
    retry: false,
    placeholderData: defaultData,
  })

  if (isFetching)
    return <span className="i-ri-loader-2-line size-3 shrink-0 animate-spin text-text-tertiary" />

  if (isError)
    return <span {...props}>{defaultData.repo.stars.toLocaleString()}</span>

  return <span {...props}>{data?.repo.stars.toLocaleString()}</span>
}

export default GithubStar
