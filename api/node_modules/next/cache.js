const cacheExports = {
  unstable_cache: require('next/dist/server/web/spec-extension/unstable-cache')
    .unstable_cache,
  revalidateTag: require('next/dist/server/web/spec-extension/revalidate')
    .revalidateTag,
  revalidatePath: require('next/dist/server/web/spec-extension/revalidate')
    .revalidatePath,
  unstable_noStore:
    require('next/dist/server/web/spec-extension/unstable-no-store')
      .unstable_noStore,
}

// https://nodejs.org/api/esm.html#commonjs-namespaces
// When importing CommonJS modules, the module.exports object is provided as the default export
module.exports = cacheExports

// make import { xxx } from 'next/cache' work
exports.unstable_cache = cacheExports.unstable_cache
exports.revalidatePath = cacheExports.revalidatePath
exports.revalidateTag = cacheExports.revalidateTag
exports.unstable_noStore = cacheExports.unstable_noStore
