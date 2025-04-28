import type { CrawlOptions } from '@/models/datasets'

export const DEFAULT_CRAWL_OPTIONS: CrawlOptions = {
  crawl_sub_pages: true,
  only_main_content: true,
  includes: '',
  excludes: '',
  limit: 10,
  max_depth: '',
  use_sitemap: true,
}
