// export basePath to next.config.js
// same as the one exported from var.ts
module.exports = {
  basePath: '',
  assetPrefix: process.env.NEXT_PUBLIC_DEPLOY_ENV === 'PRODUCTION' ? '/os/dify/ai-dify' : '',
}
