const translation = {
  title: 'Тестирование поиска',
  desc: 'Проверьте эффективность поиска в базе знаний на основе заданного текста запроса.',
  dateTimeFormat: 'DD.MM.YYYY HH:mm',
  table: {
    header: {
      source: 'Источник',
      time: 'Время',
      queryContent: 'Содержимое запроса',
    },
  },
  input: {
    title: 'Исходный текст',
    placeholder: 'Пожалуйста, введите текст, рекомендуется использовать короткое повествовательное предложение.',
    countWarning: 'До 200 символов.',
    indexWarning: 'Только база знаний высокого качества.',
    testing: 'Тестирование',
  },
  hit: {
    title: 'НАЙДЕННЫЕ АБЗАЦЫ',
    emptyTip: 'Результаты тестирования поиска будут отображаться здесь',
  },
  noRecentTip: 'Здесь нет результатов недавних запросов',
  viewChart: 'Посмотреть ВЕКТОРНУЮ ДИАГРАММУ',
  viewDetail: 'Подробнее',
  settingTitle: 'Настройка извлечения',
  records: 'Записи',
  hitChunks: 'Попадание {{num}} дочерних чанков',
  chunkDetail: 'Деталь Чанка',
  open: 'Открытый',
  keyword: 'Ключевые слова',
  imageUploader: {
    tip: 'Загрузите или перетащите изображения (Макс. {{batchCount}}, {{size}} МБ каждое)',
    tooltip: 'Загрузите изображения (макс. {{batchCount}}, {{size}} МБ каждое)',
    dropZoneTip: 'Перетащите файл сюда для загрузки',
    singleChunkAttachmentLimitTooltip: 'Количество одноэлементных вложений не может превышать {{limit}}',
  },
}

export default translation
