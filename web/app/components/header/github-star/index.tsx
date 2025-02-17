'use client'
import { useQuery } from '@tanstack/react-query'
import type { FC } from 'react'
import type { GithubRepo } from '@/models/common'

const getStar = async () => {
  const res = await fetch('https://api.github.com/repos/langgenius/dify')

  if (!res.ok)
    throw new Error('Failed to fetch github star')

  return res.json()
}

const GithubStar: FC<{ className: string }> = (props) => {
  const { isFetching, data } = useQuery<GithubRepo>({
    queryKey: ['github-star'],
    queryFn: getStar,
    enabled: process.env.NODE_ENV !== 'development',
    initialData: { stargazers_count: 6000 },
  })
  if (isFetching)
    return null
  return <span {...props}>{data.stargazers_count.toLocaleString()}</span>
}

export default GithubStar
