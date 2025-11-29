const translation = {
  subscription: {
    title: 'Suscripciones',
    listNum: 'suscripciones de {{num}}',
    empty: {
      title: 'Sin suscripciones',
      button: 'Nueva suscripción',
    },
    createButton: {
      oauth: 'Nueva suscripción con OAuth',
      apiKey: 'Nueva suscripción con clave API',
      manual: 'Pega la URL para crear una nueva suscripción',
    },
    createSuccess: 'Suscripción creada con éxito',
    createFailed: 'No se pudo crear la suscripción',
    maxCount: 'Máximo {{num}} suscripciones',
    selectPlaceholder: 'Seleccionar suscripción',
    noSubscriptionSelected: 'No se ha seleccionado ninguna suscripción',
    subscriptionRemoved: 'Suscripción eliminada',
    list: {
      title: 'Suscripciones',
      addButton: 'Agregar',
      tip: 'Recibir eventos mediante suscripción',
      item: {
        enabled: 'Habilitado',
        disabled: 'Desactivado',
        credentialType: {
          api_key: 'Clave de API',
          oauth2: 'OAuth',
          unauthorized: 'Manual',
        },
        actions: {
          delete: 'Eliminar',
          deleteConfirm: {
            title: '¿Eliminar {{name}}?',
            success: 'Suscripción {{name}} eliminada con éxito',
            error: 'Error al eliminar la suscripción {{name}}',
            content: 'Una vez eliminada, esta suscripción no se puede recuperar. Por favor, confirme.',
            contentWithApps: 'La suscripción actual está referenciada por {{count}} aplicaciones. Eliminarla hará que las aplicaciones configuradas dejen de recibir eventos de suscripción.',
            confirm: 'Confirmar eliminación',
            cancel: 'Cancelar',
            confirmInputWarning: 'Por favor, ingrese el nombre correcto para confirmar.',
            confirmInputPlaceholder: 'Introduce "{{name}}" para confirmar.',
            confirmInputTip: 'Por favor, introduzca “{{name}}” para confirmar.',
          },
        },
        status: {
          active: 'activo',
          inactive: 'inactivo',
        },
        usedByNum: 'Utilizado por {{num}} flujos de trabajo',
        noUsed: 'No se utilizó ningún flujo de trabajo',
      },
    },
    addType: {
      title: 'Añadir suscripción',
      description: 'Elige cómo quieres crear tu suscripción de activador',
      options: {
        apikey: {
          title: 'Crear con clave API',
          description: 'Crear suscripción automáticamente usando credenciales de API',
        },
        oauth: {
          title: 'Crear con OAuth',
          description: 'Autorizar con una plataforma de terceros para crear una suscripción',
          clientSettings: 'Configuración del cliente OAuth',
          clientTitle: 'Cliente OAuth',
          default: 'predeterminado',
          custom: 'Personalizado',
        },
        manual: {
          title: 'Configuración manual',
          description: 'Pega la URL para crear una nueva suscripción',
          tip: 'Configurar la URL en la plataforma de terceros manualmente',
        },
      },
    },
  },
  modal: {
    steps: {
      verify: 'Verificar',
      configuration: 'Configuración',
    },
    common: {
      cancel: 'Cancelar',
      back: 'Atrás',
      next: 'Siguiente',
      create: 'Crear',
      verify: 'Verificar',
      authorize: 'Autorizar',
      creating: 'Creando...',
      verifying: 'Verificando...',
      authorizing: 'Autorizando...',
    },
    oauthRedirectInfo: 'Dado que no se encontraron secretos de cliente del sistema para este proveedor de herramientas, es necesario configurarlo manualmente; para redirect_uri, por favor use',
    apiKey: {
      title: 'Crear con clave API',
      verify: {
        title: 'Verificar credenciales',
        description: 'Por favor, proporciona tus credenciales de API para verificar el acceso',
        error: 'La verificación de las credenciales falló. Por favor, revisa tu clave API.',
        success: 'Credenciales verificadas con éxito',
      },
      configuration: {
        title: 'Configurar suscripción',
        description: 'Configura los parámetros de tu suscripción',
      },
    },
    oauth: {
      title: 'Crear con OAuth',
      authorization: {
        title: 'Autorización OAuth',
        description: 'Autoriza a Dify para acceder a tu cuenta',
        redirectUrl: 'URL de redirección',
        redirectUrlHelp: 'Utiliza esta URL en la configuración de tu aplicación OAuth',
        authorizeButton: 'Autorizar con {{provider}}',
        waitingAuth: 'Esperando autorización...',
        authSuccess: 'Autorización exitosa',
        authFailed: 'Error al obtener la información de autorización OAuth',
        waitingJump: 'Autorizado, esperando para saltar',
      },
      configuration: {
        title: 'Configurar suscripción',
        description: 'Configura los parámetros de tu suscripción después de la autorización',
        success: 'Configuración de OAuth exitosa',
        failed: 'La configuración de OAuth falló',
      },
      remove: {
        success: 'Eliminación de OAuth exitosa',
        failed: 'Error al eliminar OAuth',
      },
      save: {
        success: 'Configuración de OAuth guardada con éxito',
      },
    },
    manual: {
      title: 'Configuración manual',
      description: 'Configura tu suscripción al webhook manualmente',
      logs: {
        title: 'Registros de solicitudes',
        request: 'Solicitud',
        loading: 'Esperando solicitud de {{pluginName}}...',
      },
    },
    form: {
      subscriptionName: {
        label: 'Nombre de la suscripción',
        placeholder: 'Ingrese el nombre de la suscripción',
        required: 'Se requiere el nombre de la suscripción',
      },
      callbackUrl: {
        label: 'URL de retorno de llamada',
        description: 'Esta URL recibirá eventos de webhook',
        tooltip: 'Proporcione un endpoint accesible públicamente que pueda recibir solicitudes de devolución de llamada del proveedor del activador.',
        placeholder: 'Generando...',
        privateAddressWarning: 'Esta URL parece ser una dirección interna, lo que puede hacer que las solicitudes del webhook fallen. Puede cambiar TRIGGER_URL a una dirección pública.',
      },
    },
    errors: {
      createFailed: 'No se pudo crear la suscripción',
      verifyFailed: 'No se pudieron verificar las credenciales',
      authFailed: 'Autorización fallida',
      networkError: 'Error de red, por favor intenta de nuevo',
    },
  },
  events: {
    title: 'Eventos Disponibles',
    description: 'Eventos a los que este complemento de activación puede suscribirse',
    empty: 'No hay eventos disponibles',
    event: 'Evento',
    events: 'Eventos',
    actionNum: '{{num}} {{event}} INCLUIDO',
    item: {
      parameters: 'parámetros {{count}}',
      noParameters: 'Sin parámetros',
    },
    output: 'Salida',
  },
  node: {
    status: {
      warning: 'Desconectar',
    },
  },
}

export default translation
