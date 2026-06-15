# CONTRIBUIR

Así que estás buscando contribuir a Dify - eso es fantástico, estamos ansiosos por ver lo que haces. Como una startup con personal y financiación limitados, tenemos grandes ambiciones de diseñar el flujo de trabajo más intuitivo para construir y gestionar aplicaciones LLM. Cualquier ayuda de la comunidad cuenta, realmente.

Necesitamos ser ágiles y enviar rápidamente dado donde estamos, pero también queremos asegurarnos de que colaboradores como tú obtengan una experiencia lo más fluida posible al contribuir. Hemos elaborado esta guía de contribución con ese propósito, con el objetivo de familiarizarte con la base de código y cómo trabajamos con los colaboradores, para que puedas pasar rápidamente a la parte divertida.

Esta guía, como Dify mismo, es un trabajo en constante progreso. Agradecemos mucho tu comprensión si a veces se queda atrás del proyecto real, y damos la bienvenida a cualquier comentario para que podamos mejorar.

En términos de licencia, por favor tómate un minuto para leer nuestro breve [Acuerdo de Licencia y Colaborador](../../LICENSE). La comunidad también se adhiere al [código de conducta](https://github.com/langgenius/.github/blob/main/CODE_OF_CONDUCT.md).

## Antes de empezar

¿Buscas algo en lo que trabajar? Explora nuestros [buenos primeros issues](https://github.com/langgenius/dify/issues?q=is%3Aissue%20state%3Aopen%20label%3A%22good%20first%20issue%22) y elige uno para comenzar.

¿Tienes un nuevo modelo o herramienta genial para añadir? Abre un PR en nuestro [repositorio de plugins](https://github.com/langgenius/dify-plugins) y muéstranos lo que has construido.

¿Necesitas actualizar un modelo existente, herramienta o corregir algunos errores? Dirígete a nuestro [repositorio oficial de plugins](https://github.com/langgenius/dify-official-plugins) y haz tu magia.

¡Únete a la diversión, contribuye y construyamos algo increíble juntos! 💡✨

No olvides vincular un issue existente o abrir uno nuevo en la descripción del PR.

### Informes de errores

> [!IMPORTANT]
> Por favor, asegúrate de incluir la siguiente información al enviar un informe de error:

- Un título claro y descriptivo
- Una descripción detallada del error, incluyendo cualquier mensaje de error
- Pasos para reproducir el error
- Comportamiento esperado
- **Logs**, si están disponibles, para problemas del backend, esto es realmente importante, puedes encontrarlos en los logs de docker-compose
- Capturas de pantalla o videos, si es aplicable

Cómo priorizamos:

| Tipo de Issue                                                                                                                       | Prioridad       |
| ----------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| Errores en funciones principales (servicio en la nube, no poder iniciar sesión, aplicaciones que no funcionan, fallos de seguridad) | Crítica         |
| Errores no críticos, mejoras de rendimiento                                                                                         | Prioridad Media |
| Correcciones menores (errores tipográficos, UI confusa pero funcional)                                                              | Prioridad Baja  |

### Solicitudes de funcionalidades

> [!NOTE]
> Por favor, asegúrate de incluir la siguiente información al enviar una solicitud de funcionalidad:

- Un título claro y descriptivo
- Una descripción detallada de la funcionalidad
- Un caso de uso para la funcionalidad
- Cualquier otro contexto o capturas de pantalla sobre la solicitud de funcionalidad

Cómo priorizamos:

| Tipo de Funcionalidad                                                                                                                                             | Prioridad            |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| Funcionalidades de alta prioridad etiquetadas por un miembro del equipo                                                                                           | Prioridad Alta       |
| Solicitudes populares de funcionalidades de nuestro [tablero de comentarios de la comunidad](https://github.com/langgenius/dify/discussions/categories/feedbacks) | Prioridad Media      |
| Funcionalidades no principales y mejoras menores                                                                                                                  | Prioridad Baja       |
| Valiosas pero no inmediatas                                                                                                                                       | Futura-Funcionalidad |

## Enviando tu PR

### Proceso de Pull Request

1. Haz un fork del repositorio
1. Antes de redactar un PR, por favor crea un issue para discutir los cambios que quieres hacer
1. Crea una nueva rama para tus cambios
1. Por favor añade pruebas para tus cambios en consecuencia
1. Asegúrate de que tu código pasa las pruebas existentes
1. Por favor vincula el issue en la descripción del PR, `fixes #<número_del_issue>`
1. ¡Fusiona tu código!

### Configuración del proyecto

#### Frontend

Para configurar el servicio frontend, por favor consulta nuestra [guía completa](https://github.com/langgenius/dify/blob/main/web/README.md) en el archivo `web/README.md`. Este documento proporciona instrucciones detalladas para ayudarte a configurar el entorno frontend correctamente.

#### Backend

Para configurar el servicio backend, por favor consulta nuestras [instrucciones detalladas](https://github.com/langgenius/dify/blob/main/api/README.md) en el archivo `api/README.md`. Este documento contiene una guía paso a paso para ayudarte a poner en marcha el backend sin problemas.

#### Otras cosas a tener en cuenta

Recomendamos revisar este documento cuidadosamente antes de proceder con la configuración, ya que contiene información esencial sobre:

- Requisitos previos y dependencias
- Pasos de instalación
- Detalles de configuración
- Consejos comunes de solución de problemas

No dudes en contactarnos si encuentras algún problema durante el proceso de configuración.

## Obteniendo Ayuda

Si alguna vez te quedas atascado o tienes una pregunta urgente mientras contribuyes, simplemente envíanos tus consultas a través del issue relacionado de GitHub, o únete a nuestro [Discord](https://discord.gg/8Tpq4AcN9c) para una charla rápida.
