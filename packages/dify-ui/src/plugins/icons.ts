import { getIconCollections, iconsPlugin } from '@egoist/tailwindcss-icons'

export default iconsPlugin({
  collections: getIconCollections(['ri']),
  extraProperties: {
    width: '1rem',
    height: '1rem',
    display: 'block',
  },
})
