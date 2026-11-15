"""Malware scanning for stored files, independent of the product module that owns the file.

``core.file_scan`` only knows how to ask one scanner about one file. Policies, records and the
entry point other modules call live in ``services.file_scan``.
"""
