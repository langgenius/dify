"""Failures resolving resources owned by annotation use cases."""


class AnnotationResourceNotFoundError(Exception):
    """The app, message, annotation or annotation setting is unavailable."""
