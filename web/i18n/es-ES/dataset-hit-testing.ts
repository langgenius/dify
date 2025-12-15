const translation = {
  title: 'Prueba de recuperación',
  desc: 'Prueba del efecto de impacto del conocimiento basado en el texto de consulta proporcionado.',
  dateTimeFormat: 'MM/DD/YYYY hh:mm A',
  table: {
    header: {
      source: 'Fuente',
      time: 'Tiempo',
      queryContent: 'Contenido de la consulta',
    },
  },
  input: {
    title: 'Texto fuente',
    placeholder: 'Por favor ingrese un texto, se recomienda una oración declarativa corta.',
    countWarning: 'Hasta 200 caracteres.',
    indexWarning: 'Solo conocimiento de alta calidad.',
    testing: 'Prueba',
  },
  hit: {
    title: 'PÁRRAFOS DE RECUPERACIÓN',
    emptyTip: 'Los resultados de la prueba de recuperación se mostrarán aquí',
  },
  noRecentTip: 'No hay resultados de consulta recientes aquí',
  viewChart: 'Ver GRÁFICO VECTORIAL',
  viewDetail: 'Ver Detalle',
  settingTitle: 'Configuración de recuperación',
  open: 'Abrir',
  records: 'Archivo',
  chunkDetail: 'Detalle de fragmentos',
  keyword: 'Palabras clave',
  hitChunks: 'Golpea {{num}} fragmentos secundarios',
  imageUploader: {
    tip: 'Sube o arrastra imágenes (Máx. {{batchCount}}, {{size}}MB cada una)',
    tooltip: 'Sube imágenes (Máx. {{batchCount}}, {{size}} MB cada una)',
    dropZoneTip: 'Arrastra el archivo aquí para subirlo',
    singleChunkAttachmentLimitTooltip: 'El número de archivos adjuntos de un solo bloque no puede superar {{limit}}',
  },
}

export default translation
