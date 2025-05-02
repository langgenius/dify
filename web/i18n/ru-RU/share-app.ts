const translation = {
  common: {
    welcome: '',
    appUnavailable: 'Приложение недоступно',
    appUnknownError: 'Приложение недоступно',
  },
  chat: {
    newChat: 'Новый чат',
    pinnedTitle: 'Закрепленные',
    unpinnedTitle: 'Чаты',
    newChatDefaultName: 'Новый разговор',
    resetChat: 'Сбросить разговор',
    poweredBy: 'Работает на',
    prompt: 'Подсказка',
    privatePromptConfigTitle: 'Настройки разговора',
    publicPromptConfigTitle: 'Начальная подсказка',
    configStatusDes: 'Перед началом вы можете изменить настройки разговора',
    configDisabled:
      'Для этого сеанса использовались настройки предыдущего сеанса.',
    startChat: 'Начать чат',
    privacyPolicyLeft:
      'Пожалуйста, ознакомьтесь с ',
    privacyPolicyMiddle:
      'политикой конфиденциальности',
    privacyPolicyRight:
      ', предоставленной разработчиком приложения.',
    deleteConversation: {
      title: 'Удалить разговор',
      content: 'Вы уверены, что хотите удалить этот разговор?',
    },
    tryToSolve: 'Попробуйте решить',
    temporarySystemIssue: 'Извините, временная проблема с системой.',
    expand: 'Развернуть',
    collapse: 'Свернуть',
  },
  generation: {
    tabs: {
      create: 'Запустить один раз',
      batch: 'Запустить пакетно',
      saved: 'Сохраненные',
    },
    savedNoData: {
      title: 'Вы еще не сохранили ни одного результата!',
      description: 'Начните генерировать контент, и вы найдете свои сохраненные результаты здесь.',
      startCreateContent: 'Начать создавать контент',
    },
    title: 'Завершение ИИ',
    queryTitle: 'Содержимое запроса',
    completionResult: 'Результат завершения',
    queryPlaceholder: 'Напишите содержимое вашего запроса...',
    run: 'Выполнить',
    copy: 'Копировать',
    resultTitle: 'Завершение ИИ',
    noData: 'ИИ даст вам то, что вы хотите, здесь.',
    csvUploadTitle: 'Перетащите сюда свой CSV-файл или ',
    browse: 'обзор',
    csvStructureTitle: 'CSV-файл должен соответствовать следующей структуре:',
    downloadTemplate: 'Скачать шаблон здесь',
    field: 'Поле',
    batchFailed: {
      info: '{{num}} неудачных выполнений',
      retry: 'Повторить попытку',
      outputPlaceholder: 'Нет выходного содержимого',
    },
    errorMsg: {
      empty: 'Пожалуйста, введите содержимое в загруженный файл.',
      fileStructNotMatch: 'Загруженный CSV-файл не соответствует структуре.',
      emptyLine: 'Строка {{rowIndex}} пуста',
      invalidLine: 'Строка {{rowIndex}}: значение {{varName}} не может быть пустым',
      moreThanMaxLengthLine: 'Строка {{rowIndex}}: значение {{varName}} не может превышать {{maxLength}} символов',
      atLeastOne: 'Пожалуйста, введите хотя бы одну строку в загруженный файл.',
    },
  },
}

export default translation
