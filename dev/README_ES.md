[English](./README.md) | [简体中文](./README_CN.md) | [日本語](./README_JA.md) | [Español](./README_ES.md) | [Français](./README_FR.md)

# Herramientas de desarrollo local de Dify.ai

## Gestión de Estilo de Código - mejorando la calidad del código

Asegurar la calidad del código consistente mediante la creación de ganchos pre-commit.

La calidad del código consistente agiliza el desarrollo mediante la aplicación automática de las normas de código. Esto minimiza las desviaciones y simplifica la revisión del código. Puede parecer fuerte, pero es beneficioso ya que fomenta un flujo de trabajo más eficiente y cohesivo.

Es una medida proactiva para detectar problemas al principio del ciclo de desarrollo, ahorrando tiempo y manteniendo la calidad del código.

### Configuración de pre-commit

Para instalar los hooks de pre-commit, ejecute:

```sh
# ATENCIÓN: si lo usas, asegúrate de que estás en tu entorno virtual

# instala el paquete pip y el hook git para pre-commit
make install_local_dev

# Opcional: Enlace al script de pre-commit de los repositorios (significa que el proyecto puede tener una lógica centralizada de pre-commit)
ln -s pre-commit .git/hooks/pre-commit
```

### Qué se comprueba

Nuestra configuración pre-commit comprueba los espacios en blanco, los correctores de EOF, y la validación de sintaxis para varios formatos de archivo. También comprueba posibles problemas de seguridad como claves privadas expuestas.

### Ganchos

Utilizamos hooks de `pre-commit-hooks` para comprobaciones generales, junto con `ruff-pre-commit` para linting específico de Python.

Consulta `.pre-commit-config.yaml` para ver la configuración detallada de los ganchos.

## Pruebas

Mantenga la integridad del código con nuestro conjunto de pruebas:

### Pruebas de integración

Ejecuta las pruebas de integración de la API del modelo:

```sh
pytest api/pruebas/pruebas_integración/
```

### Pruebas unitarias

Evaluar la funcionalidad de la herramienta:

```sh
pytest api/tests/unit_tests/
```
