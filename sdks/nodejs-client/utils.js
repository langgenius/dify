export function mergeDefaultOptions(defaultOptions, options) {
  const mergedOptions = { ...defaultOptions };

  for (const key in options) {
    if (typeof options[key] === 'object' && options[key]) {
      mergedOptions[key] = mergeDefaultOptions(defaultOptions?.[key], options[key]);
    } else {
      mergedOptions[key] = options[key];
    }
  }

  return mergedOptions;
}