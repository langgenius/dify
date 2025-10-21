const translation = {
  welcome: {
    firstStepTip: 'Para comenzar,',
    enterKeyTip: 'ingresa tu clave de API de OpenAI a continuación',
    getKeyTip: 'Obtén tu clave de API desde el panel de control de OpenAI',
    placeholder: 'Tu clave de API de OpenAI (ej. sk-xxxx)',
  },
  apiKeyInfo: {
    cloud: {
      trial: {
        title: 'Estás utilizando la cuota de prueba de {{providerName}}.',
        description: 'La cuota de prueba se proporciona para su uso de prueba. Antes de que se agoten las llamadas de la cuota de prueba, configure su propio proveedor de modelos o compre cuota adicional.',
      },
      exhausted: {
        title: 'Tu cuota de prueba se ha agotado, por favor configura tu APIKey.',
        description: 'Tu cuota de prueba se ha agotado. Por favor, configure su propio proveedor de modelos o compre cuota adicional.',
      },
    },
    selfHost: {
      title: {
        row1: 'Para comenzar,',
        row2: 'configura primero tu proveedor de modelos.',
      },
    },
    callTimes: 'Veces llamadas',
    usedToken: 'Token utilizados',
    setAPIBtn: 'Ir a configurar proveedor de modelos',
    tryCloud: 'O prueba la versión en la nube de Dify con una cotización gratuita',
  },
  overview: {
    title: 'Resumen',
    appInfo: {
      explanation: 'Aplicación web de IA lista para usar',
      accessibleAddress: 'URL pública',
      preview: 'Vista previa',
      regenerate: 'Regenerar',
      regenerateNotice: '¿Deseas regenerar la URL pública?',
      preUseReminder: 'Por favor, habilita la aplicación web antes de continuar.',
      settings: {
        entry: 'Configuración',
        title: 'Configuración de la aplicación web',
        webName: 'Nombre de la aplicación web',
        webDesc: 'Descripción de la aplicación web',
        webDescTip: 'Este texto se mostrará en el lado del cliente, proporcionando una guía básica sobre cómo usar la aplicación',
        webDescPlaceholder: 'Ingresa la descripción de la aplicación web',
        language: 'Idioma',
        workflow: {
          title: 'Pasos del flujo de trabajo',
          show: 'Mostrar',
          hide: 'Ocultar',
          subTitle: 'Detalles del flujo de trabajo',
          showDesc: 'Mostrar u ocultar detalles del flujo de trabajo en web app',
        },
        chatColorTheme: 'Tema de color del chat',
        chatColorThemeDesc: 'Establece el tema de color del chatbot',
        chatColorThemeInverted: 'Invertido',
        invalidHexMessage: 'Valor hexadecimal no válido',
        invalidPrivacyPolicy: 'Enlace de política de privacidad no válido. Por favor, utiliza un enlace válido que comience con http o https',
        more: {
          entry: 'Mostrar más configuraciones',
          copyright: 'Derechos de autor',
          copyRightPlaceholder: 'Ingresa el nombre del autor o la organización',
          privacyPolicy: 'Política de privacidad',
          privacyPolicyPlaceholder: 'Ingresa el enlace de la política de privacidad',
          privacyPolicyTip: 'Ayuda a los visitantes a comprender los datos que recopila la aplicación, consulta la <privacyPolicyLink>Política de privacidad</privacyPolicyLink> de Dify.',
          customDisclaimer: 'Descargo de responsabilidad personalizado',
          customDisclaimerPlaceholder: 'Ingresa el texto de descargo de responsabilidad personalizado',
          customDisclaimerTip: 'El texto de descargo de responsabilidad personalizado se mostrará en el lado del cliente, proporcionando información adicional sobre la aplicación',
          copyrightTip: 'Mostrar información de derechos de autor en la aplicación web',
          copyrightTooltip: 'Actualice al plan Profesional o superior',
        },
        sso: {
          description: 'Todos los usuarios deben iniciar sesión con SSO antes de usar web app',
          tooltip: 'Póngase en contacto con el administrador para habilitar el inicio de sesión único de web app',
          label: 'Autenticación SSO',
          title: 'web app SSO',
        },
        modalTip: 'Configuración de la aplicación web del lado del cliente.',
      },
      embedded: {
        entry: 'Incrustado',
        title: 'Incrustar en el sitio web',
        explanation: 'Elige la forma de incrustar la aplicación de chat en tu sitio web',
        iframe: 'Para agregar la aplicación de chat en cualquier lugar de tu sitio web, agrega este iframe a tu código HTML.',
        scripts: 'Para agregar una aplicación de chat en la esquina inferior derecha de tu sitio web, agrega este código a tu HTML.',
        chromePlugin: 'Instalar la extensión de Chrome de Dify Chatbot',
        copied: 'Copiado',
        copy: 'Copiar',
      },
      qrcode: {
        title: 'Código QR para compartir',
        scan: 'Escanear para compartir la aplicación',
        download: 'Descargar código QR',
      },
      customize: {
        way: 'forma',
        entry: 'Personalizar',
        title: 'Personalizar la aplicación web de IA',
        explanation: 'Puedes personalizar el frontend de la aplicación web para adaptarlo a tus necesidades y estilo.',
        way1: {
          name: 'Bifurca el código del cliente, modifícalo y despliégalo en Vercel (recomendado)',
          step1: 'Bifurca el código del cliente y modifícalo',
          step1Tip: 'Haz clic aquí para bifurcar el código fuente en tu cuenta de GitHub y modificar el código',
          step1Operation: 'Dify-WebClient',
          step2: 'Despliégalo en Vercel',
          step2Tip: 'Haz clic aquí para importar el repositorio en Vercel y desplegarlo',
          step2Operation: 'Importar repositorio',
          step3: 'Configura las variables de entorno',
          step3Tip: 'Agrega las siguientes variables de entorno en Vercel',
        },
        way2: {
          name: 'Escribe código del lado del cliente para llamar a la API y despliégalo en un servidor',
          operation: 'Documentación',
        },
      },
      launch: 'Lanzar',
    },
    apiInfo: {
      title: 'API del servicio backend',
      explanation: 'Fácilmente integrable en tu aplicación',
      accessibleAddress: 'Punto de conexión de la API del servicio',
      doc: 'Referencia de la API',
    },
    status: {
      running: 'En servicio',
      disable: 'Deshabilitar',
    },
  },
  analysis: {
    title: 'Análisis',
    ms: 'ms',
    tokenPS: 'Token/s',
    totalMessages: {
      title: 'Mensajes totales',
      explanation: 'Recuento diario de interacciones con IA.',
    },
    totalConversations: {
      title: 'Conversaciones totales',
      explanation: 'Recuento diario de conversaciones con IA; ingeniería/depuración de prompts excluida.',
    },
    activeUsers: {
      title: 'Usuarios activos',
      explanation: 'Usuarios únicos que interactúan en preguntas y respuestas con IA; excluye la ingeniería/depuración de prompts.',
    },
    tokenUsage: {
      title: 'Uso de tokens',
      explanation: 'Refleja el uso diario de tokens del modelo de lenguaje para la aplicación, útil para el control de costos.',
      consumed: 'Consumidos',
    },
    avgSessionInteractions: {
      title: 'Interacciones promedio por sesión',
      explanation: 'Recuento continuo de comunicación usuario-IA; para aplicaciones basadas en conversaciones.',
    },
    avgUserInteractions: {
      title: 'Interacciones promedio por usuario',
      explanation: 'Refleja la frecuencia de uso diario de los usuarios. Esta métrica refleja la fidelidad del usuario.',
    },
    userSatisfactionRate: {
      title: 'Tasa de satisfacción del usuario',
      explanation: 'El número de likes por cada 1,000 mensajes. Esto indica la proporción de respuestas con las que los usuarios están muy satisfechos.',
    },
    avgResponseTime: {
      title: 'Tiempo promedio de respuesta',
      explanation: 'Tiempo (ms) que tarda la IA en procesar/responder; para aplicaciones basadas en texto.',
    },
    tps: {
      title: 'Velocidad de salida de tokens',
      explanation: 'Mide el rendimiento del LLM. Cuenta la velocidad de salida de tokens del LLM desde el inicio de la solicitud hasta la finalización de la salida.',
    },
  },
}

export default translation
