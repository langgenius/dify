import UnoCSS from '@unocss/postcss'
import autoprefixer from 'autoprefixer'

export default {
  plugins: [
    UnoCSS(),
    autoprefixer(),
  ],
}
