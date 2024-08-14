const translation = {
  common: {
    welcome: '',
    appUnavailable: 'La aplicación no está disponible',
    appUnkonwError: 'La aplicación no está disponible',
  },
  chat: {
    newChat: 'Nuevo chat',
    pinnedTitle: 'Fijados',
    unpinnedTitle: 'Chats',
    newChatDefaultName: 'Nueva conversación',
    resetChat: 'Reiniciar conversación',
    powerBy: 'Desarrollado por',
    prompt: 'Indicación',
    privatePromptConfigTitle: 'Configuración de la conversación',
    publicPromptConfigTitle: 'Indicación inicial',
    configStatusDes: 'Antes de comenzar, puedes modificar la configuración de la conversación',
    configDisabled:
      'Se han utilizado las configuraciones de la sesión anterior para esta sesión.',
    startChat: 'Iniciar chat',
    privacyPolicyLeft:
      'Por favor, lee la ',
    privacyPolicyMiddle:
      'política de privacidad',
    privacyPolicyRight:
      ' proporcionada por el desarrollador de la aplicación.',
    deleteConversation: {
      title: 'Eliminar conversación',
      content: '¿Estás seguro/a de que quieres eliminar esta conversación?',
    },
    tryToSolve: 'Intentar resolver',
    temporarySystemIssue: 'Lo sentimos, hay un problema temporal del sistema.',
  },
  generation: {
    tabs: {
      create: 'Ejecutar una vez',
      batch: 'Ejecutar en lote',
      saved: 'Guardado',
    },
    savedNoData: {
      title: '¡Aún no has guardado ningún resultado!',
      description: 'Comienza a generar contenido y encuentra tus resultados guardados aquí.',
      startCreateContent: 'Comenzar a crear contenido',
    },
    title: 'Completado por IA',
    queryTitle: 'Contenido de la consulta',
    completionResult: 'Resultado del completado',
    queryPlaceholder: 'Escribe tu contenido de consulta...',
    run: 'Ejecutar',
    copy: 'Copiar',
    resultTitle: 'Completado por IA',
    noData: 'La IA te dará lo que deseas aquí.',
    csvUploadTitle: 'Arrastra y suelta tu archivo CSV aquí, o ',
    browse: 'navega',
    csvStructureTitle: 'El archivo CSV debe cumplir con la siguiente estructura:',
    downloadTemplate: 'Descarga la plantilla aquí',
    field: 'Campo',
    batchFailed: {
      info: '{{num}} ejecuciones fallidas',
      retry: 'Reintentar',
      outputPlaceholder: 'Sin contenido de salida',
    },
    errorMsg: {
      empty: 'Por favor, ingresa contenido en el archivo cargado.',
      fileStructNotMatch: 'El archivo CSV cargado no coincide con la estructura.',
      emptyLine: 'La fila {{rowIndex}} está vacía',
      invalidLine: 'Fila {{rowIndex}}: el valor de {{varName}} no puede estar vacío',
      moreThanMaxLengthLine: 'Fila {{rowIndex}}: el valor de {{varName}} no puede tener más de {{maxLength}} caracteres',
      atLeastOne: 'Por favor, ingresa al menos una fila en el archivo cargado.',
    },
  },
}

export default translation
