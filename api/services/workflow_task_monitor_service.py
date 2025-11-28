"""
Workflow Task Monitor Service for Dify.

This module provides comprehensive monitoring and management utilities for workflow
task execution, including task state tracking, timeout handling, stuck task detection,
and task lifecycle management.

Related Issue: #15500 - Workflow tasks are completed but cannot be ended
"""

from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, Field


class TaskState(StrEnum):
    """Possible states for a workflow task."""

    PENDING = "pending"
    QUEUED = "queued"
    RUNNING = "running"
    PAUSED = "paused"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"
    TIMEOUT = "timeout"
    STUCK = "stuck"


class TaskPriority(StrEnum):
    """Priority levels for workflow tasks."""

    LOW = "low"
    NORMAL = "normal"
    HIGH = "high"
    CRITICAL = "critical"


@dataclass
class TaskMetrics:
    """Metrics for a workflow task."""

    start_time: datetime | None = None
    end_time: datetime | None = None
    queue_time: datetime | None = None
    execution_duration_ms: int = 0
    retry_count: int = 0
    node_count: int = 0
    completed_nodes: int = 0
    failed_nodes: int = 0
    memory_usage_bytes: int = 0
    cpu_time_ms: int = 0


@dataclass
class TaskCheckpoint:
    """Checkpoint data for task recovery."""

    checkpoint_id: str
    task_id: str
    timestamp: datetime
    state: TaskState
    current_node_id: str | None
    variables: dict[str, Any] = field(default_factory=dict)
    metadata: dict[str, Any] = field(default_factory=dict)


class TaskConfig(BaseModel):
    """Configuration for task monitoring."""

    timeout_seconds: int = Field(default=3600, ge=60, le=86400)
    max_retries: int = Field(default=3, ge=0, le=10)
    stuck_threshold_seconds: int = Field(default=300, ge=60, le=3600)
    checkpoint_interval_seconds: int = Field(default=60, ge=10, le=600)
    enable_auto_recovery: bool = Field(default=True)
    enable_metrics_collection: bool = Field(default=True)
    max_concurrent_tasks: int = Field(default=10, ge=1, le=100)
    priority_queue_enabled: bool = Field(default=True)


class TaskInfo(BaseModel):
    """Information about a workflow task."""

    task_id: str
    workflow_id: str
    tenant_id: str
    state: TaskState = TaskState.PENDING
    priority: TaskPriority = TaskPriority.NORMAL
    created_at: datetime = Field(default_factory=datetime.now)
    updated_at: datetime = Field(default_factory=datetime.now)
    started_at: datetime | None = None
    completed_at: datetime | None = None
    error_message: str | None = None
    current_node_id: str | None = None
    progress_percent: float = Field(default=0.0, ge=0.0, le=100.0)
    metadata: dict[str, Any] = Field(default_factory=dict)


class TaskTransition(BaseModel):
    """Record of a task state transition."""

    from_state: TaskState
    to_state: TaskState
    timestamp: datetime = Field(default_factory=datetime.now)
    reason: str | None = None
    triggered_by: str | None = None


class TaskMonitorResult(BaseModel):
    """Result of task monitoring check."""

    task_id: str
    is_healthy: bool
    state: TaskState
    issues: list[str] = Field(default_factory=list)
    recommendations: list[str] = Field(default_factory=list)
    metrics: dict[str, Any] = Field(default_factory=dict)


class WorkflowTaskMonitorService:
    """
    Service for monitoring and managing workflow task execution.

    Provides functionality for:
    - Task state tracking and transitions
    - Timeout and stuck task detection
    - Task metrics collection
    - Checkpoint management for recovery
    - Priority-based task scheduling
    """

    VALID_TRANSITIONS: dict[TaskState, set[TaskState]] = {
        TaskState.PENDING: {TaskState.QUEUED, TaskState.CANCELLED},
        TaskState.QUEUED: {TaskState.RUNNING, TaskState.CANCELLED, TaskState.TIMEOUT},
        TaskState.RUNNING: {
            TaskState.PAUSED,
            TaskState.COMPLETED,
            TaskState.FAILED,
            TaskState.CANCELLED,
            TaskState.TIMEOUT,
            TaskState.STUCK,
        },
        TaskState.PAUSED: {TaskState.RUNNING, TaskState.CANCELLED},
        TaskState.STUCK: {TaskState.RUNNING, TaskState.FAILED, TaskState.CANCELLED},
        TaskState.COMPLETED: set(),
        TaskState.FAILED: {TaskState.PENDING},
        TaskState.CANCELLED: set(),
        TaskState.TIMEOUT: {TaskState.PENDING},
    }

    def __init__(self, config: TaskConfig | None = None):
        """Initialize the task monitor service."""
        self.config = config or TaskConfig()
        self._tasks: dict[str, TaskInfo] = {}
        self._metrics: dict[str, TaskMetrics] = {}
        self._checkpoints: dict[str, list[TaskCheckpoint]] = {}
        self._transitions: dict[str, list[TaskTransition]] = {}
        self._state_handlers: dict[TaskState, list[Callable[[TaskInfo], None]]] = {
            state: [] for state in TaskState
        }

    def register_task(
        self,
        task_id: str,
        workflow_id: str,
        tenant_id: str,
        priority: TaskPriority = TaskPriority.NORMAL,
        metadata: dict[str, Any] | None = None,
    ) -> TaskInfo:
        """
        Register a new workflow task for monitoring.

        Args:
            task_id: Unique identifier for the task
            workflow_id: ID of the workflow being executed
            tenant_id: ID of the tenant owning the task
            priority: Task priority level
            metadata: Additional task metadata

        Returns:
            TaskInfo object for the registered task
        """
        task = TaskInfo(
            task_id=task_id,
            workflow_id=workflow_id,
            tenant_id=tenant_id,
            priority=priority,
            metadata=metadata or {},
        )
        self._tasks[task_id] = task
        self._metrics[task_id] = TaskMetrics()
        self._checkpoints[task_id] = []
        self._transitions[task_id] = []
        return task

    def get_task(self, task_id: str) -> TaskInfo | None:
        """Get task information by ID."""
        return self._tasks.get(task_id)

    def update_task_state(
        self,
        task_id: str,
        new_state: TaskState,
        reason: str | None = None,
        triggered_by: str | None = None,
    ) -> bool:
        """
        Update the state of a task.

        Args:
            task_id: ID of the task to update
            new_state: New state to transition to
            reason: Reason for the state change
            triggered_by: Entity that triggered the change

        Returns:
            True if transition was successful, False otherwise
        """
        task = self._tasks.get(task_id)
        if not task:
            return False

        if not self._is_valid_transition(task.state, new_state):
            return False

        old_state = task.state
        task.state = new_state
        task.updated_at = datetime.now()

        if new_state == TaskState.RUNNING and not task.started_at:
            task.started_at = datetime.now()
            metrics = self._metrics.get(task_id)
            if metrics:
                metrics.start_time = task.started_at

        if new_state in {TaskState.COMPLETED, TaskState.FAILED, TaskState.CANCELLED}:
            task.completed_at = datetime.now()
            metrics = self._metrics.get(task_id)
            if metrics and metrics.start_time:
                metrics.end_time = task.completed_at
                duration = task.completed_at - metrics.start_time
                metrics.execution_duration_ms = int(duration.total_seconds() * 1000)

        transition = TaskTransition(
            from_state=old_state,
            to_state=new_state,
            reason=reason,
            triggered_by=triggered_by,
        )
        self._transitions[task_id].append(transition)

        for handler in self._state_handlers.get(new_state, []):
            handler(task)

        return True

    def _is_valid_transition(self, from_state: TaskState, to_state: TaskState) -> bool:
        """Check if a state transition is valid."""
        valid_targets = self.VALID_TRANSITIONS.get(from_state, set())
        return to_state in valid_targets

    def update_progress(
        self,
        task_id: str,
        progress_percent: float,
        current_node_id: str | None = None,
    ) -> bool:
        """
        Update task progress.

        Args:
            task_id: ID of the task
            progress_percent: Progress percentage (0-100)
            current_node_id: ID of the currently executing node

        Returns:
            True if update was successful
        """
        task = self._tasks.get(task_id)
        if not task:
            return False

        task.progress_percent = min(100.0, max(0.0, progress_percent))
        task.current_node_id = current_node_id
        task.updated_at = datetime.now()
        return True

    def create_checkpoint(
        self,
        task_id: str,
        checkpoint_id: str,
        variables: dict[str, Any] | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> TaskCheckpoint | None:
        """
        Create a checkpoint for task recovery.

        Args:
            task_id: ID of the task
            checkpoint_id: Unique ID for the checkpoint
            variables: Current variable state
            metadata: Additional checkpoint metadata

        Returns:
            Created checkpoint or None if task not found
        """
        task = self._tasks.get(task_id)
        if not task:
            return None

        checkpoint = TaskCheckpoint(
            checkpoint_id=checkpoint_id,
            task_id=task_id,
            timestamp=datetime.now(),
            state=task.state,
            current_node_id=task.current_node_id,
            variables=variables or {},
            metadata=metadata or {},
        )
        self._checkpoints[task_id].append(checkpoint)
        return checkpoint

    def get_latest_checkpoint(self, task_id: str) -> TaskCheckpoint | None:
        """Get the most recent checkpoint for a task."""
        checkpoints = self._checkpoints.get(task_id, [])
        return checkpoints[-1] if checkpoints else None

    def detect_stuck_tasks(self) -> list[TaskInfo]:
        """
        Detect tasks that appear to be stuck.

        Returns:
            List of tasks that haven't been updated within the threshold
        """
        stuck_tasks: list[TaskInfo] = []
        threshold = timedelta(seconds=self.config.stuck_threshold_seconds)
        now = datetime.now()

        for task in self._tasks.values():
            if task.state == TaskState.RUNNING:
                time_since_update = now - task.updated_at
                if time_since_update > threshold:
                    stuck_tasks.append(task)

        return stuck_tasks

    def detect_timeout_tasks(self) -> list[TaskInfo]:
        """
        Detect tasks that have exceeded their timeout.

        Returns:
            List of tasks that have timed out
        """
        timeout_tasks: list[TaskInfo] = []
        timeout = timedelta(seconds=self.config.timeout_seconds)
        now = datetime.now()

        for task in self._tasks.values():
            if task.state == TaskState.RUNNING and task.started_at:
                elapsed = now - task.started_at
                if elapsed > timeout:
                    timeout_tasks.append(task)

        return timeout_tasks

    def monitor_task(self, task_id: str) -> TaskMonitorResult:
        """
        Perform comprehensive monitoring check on a task.

        Args:
            task_id: ID of the task to monitor

        Returns:
            TaskMonitorResult with health status and recommendations
        """
        task = self._tasks.get(task_id)
        if not task:
            return TaskMonitorResult(
                task_id=task_id,
                is_healthy=False,
                state=TaskState.PENDING,
                issues=["Task not found"],
                recommendations=["Register the task before monitoring"],
            )

        issues: list[str] = []
        recommendations: list[str] = []
        metrics_data: dict[str, Any] = {}

        if task.state == TaskState.RUNNING:
            now = datetime.now()
            time_since_update = now - task.updated_at

            if time_since_update.total_seconds() > self.config.stuck_threshold_seconds:
                issues.append("Task appears to be stuck")
                recommendations.append("Consider restarting or cancelling the task")

            if task.started_at:
                elapsed = now - task.started_at
                if elapsed.total_seconds() > self.config.timeout_seconds * 0.8:
                    issues.append("Task approaching timeout")
                    recommendations.append("Monitor closely or extend timeout")

        task_metrics = self._metrics.get(task_id)
        if task_metrics:
            metrics_data = {
                "execution_duration_ms": task_metrics.execution_duration_ms,
                "retry_count": task_metrics.retry_count,
                "completed_nodes": task_metrics.completed_nodes,
                "failed_nodes": task_metrics.failed_nodes,
            }

            if task_metrics.retry_count >= self.config.max_retries:
                issues.append("Maximum retry count reached")
                recommendations.append("Investigate root cause of failures")

        is_healthy = len(issues) == 0

        return TaskMonitorResult(
            task_id=task_id,
            is_healthy=is_healthy,
            state=task.state,
            issues=issues,
            recommendations=recommendations,
            metrics=metrics_data,
        )

    def get_tasks_by_state(self, state: TaskState) -> list[TaskInfo]:
        """Get all tasks in a specific state."""
        return [task for task in self._tasks.values() if task.state == state]

    def get_tasks_by_tenant(self, tenant_id: str) -> list[TaskInfo]:
        """Get all tasks for a specific tenant."""
        return [task for task in self._tasks.values() if task.tenant_id == tenant_id]

    def get_task_transitions(self, task_id: str) -> list[TaskTransition]:
        """Get the transition history for a task."""
        return self._transitions.get(task_id, [])

    def cleanup_completed_tasks(self, older_than_hours: int = 24) -> int:
        """
        Remove completed tasks older than specified hours.

        Args:
            older_than_hours: Age threshold in hours

        Returns:
            Number of tasks cleaned up
        """
        threshold = datetime.now() - timedelta(hours=older_than_hours)
        terminal_states = {TaskState.COMPLETED, TaskState.FAILED, TaskState.CANCELLED}
        tasks_to_remove: list[str] = []

        for task_id, task in self._tasks.items():
            if task.state in terminal_states and task.completed_at:
                if task.completed_at < threshold:
                    tasks_to_remove.append(task_id)

        for task_id in tasks_to_remove:
            del self._tasks[task_id]
            self._metrics.pop(task_id, None)
            self._checkpoints.pop(task_id, None)
            self._transitions.pop(task_id, None)

        return len(tasks_to_remove)

    def register_state_handler(
        self, state: TaskState, handler: Callable[[TaskInfo], None]
    ) -> None:
        """Register a handler to be called when tasks enter a specific state."""
        self._state_handlers[state].append(handler)

    def get_queue_statistics(self) -> dict[str, Any]:
        """Get statistics about the task queue."""
        state_counts: dict[str, int] = {state.value: 0 for state in TaskState}
        priority_counts: dict[str, int] = {priority.value: 0 for priority in TaskPriority}
        total_tasks = len(self._tasks)

        for task in self._tasks.values():
            state_counts[task.state.value] += 1
            priority_counts[task.priority.value] += 1

        running_tasks = state_counts[TaskState.RUNNING.value]
        queued_tasks = state_counts[TaskState.QUEUED.value]

        return {
            "total_tasks": total_tasks,
            "state_distribution": state_counts,
            "priority_distribution": priority_counts,
            "running_tasks": running_tasks,
            "queued_tasks": queued_tasks,
            "capacity_used_percent": (running_tasks / self.config.max_concurrent_tasks) * 100
            if self.config.max_concurrent_tasks > 0
            else 0,
        }

    def increment_retry_count(self, task_id: str) -> int:
        """
        Increment the retry count for a task.

        Returns:
            New retry count or -1 if task not found
        """
        metrics = self._metrics.get(task_id)
        if not metrics:
            return -1

        metrics.retry_count += 1
        return metrics.retry_count

    def update_node_progress(
        self,
        task_id: str,
        completed_nodes: int,
        total_nodes: int,
        failed_nodes: int = 0,
    ) -> bool:
        """
        Update node execution progress for a task.

        Args:
            task_id: ID of the task
            completed_nodes: Number of completed nodes
            total_nodes: Total number of nodes
            failed_nodes: Number of failed nodes

        Returns:
            True if update was successful
        """
        task = self._tasks.get(task_id)
        metrics = self._metrics.get(task_id)

        if not task or not metrics:
            return False

        metrics.node_count = total_nodes
        metrics.completed_nodes = completed_nodes
        metrics.failed_nodes = failed_nodes

        if total_nodes > 0:
            task.progress_percent = (completed_nodes / total_nodes) * 100

        task.updated_at = datetime.now()
        return True
