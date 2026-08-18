"""Workflow Copilot domain package.

Pure-Python, I/O-free port of the validated Go "workflow copilot" Fix engine
(dify-enterprise/server/pkg/enterprise/biz/copilot). This package must not
import Flask, SQLAlchemy, Celery, or perform network I/O; persistence and the
real Dify integration are wired in via Protocol implementations added in
later phases.
"""
