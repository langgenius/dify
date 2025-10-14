import { useRef, useState, useCallback, useEffect } from 'react';
import { areOptionsEqual, arePluginsEqual, canUseDOM } from 'embla-carousel-reactive-utils';
import EmblaCarousel from 'embla-carousel';

function useEmblaCarousel(options = {}, plugins = []) {
  const storedOptions = useRef(options);
  const storedPlugins = useRef(plugins);
  const [emblaApi, setEmblaApi] = useState();
  const [viewport, setViewport] = useState();
  const reInit = useCallback(() => {
    if (emblaApi) emblaApi.reInit(storedOptions.current, storedPlugins.current);
  }, [emblaApi]);
  useEffect(() => {
    if (areOptionsEqual(storedOptions.current, options)) return;
    storedOptions.current = options;
    reInit();
  }, [options, reInit]);
  useEffect(() => {
    if (arePluginsEqual(storedPlugins.current, plugins)) return;
    storedPlugins.current = plugins;
    reInit();
  }, [plugins, reInit]);
  useEffect(() => {
    if (canUseDOM() && viewport) {
      EmblaCarousel.globalOptions = useEmblaCarousel.globalOptions;
      const newEmblaApi = EmblaCarousel(viewport, storedOptions.current, storedPlugins.current);
      setEmblaApi(newEmblaApi);
      return () => newEmblaApi.destroy();
    } else {
      setEmblaApi(undefined);
    }
  }, [viewport, setEmblaApi]);
  return [setViewport, emblaApi];
}
useEmblaCarousel.globalOptions = undefined;

export { useEmblaCarousel as default };
//# sourceMappingURL=embla-carousel-react.esm.js.map
