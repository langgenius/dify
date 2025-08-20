"""Configuration for document upload scheduler."""

import os
from datetime import time
from celery.schedules import crontab
from configs import dify_config


class UploadSchedulerConfig:
    """Configuration class for upload scheduler."""
    
    def __init__(self):
        # Rate limiting configuration
        self.enabled = dify_config.UPLOAD_SCHEDULER_ENABLED
        self.max_uploads_per_window = dify_config.UPLOAD_MAX_PER_WINDOW
        self.time_window_minutes = dify_config.UPLOAD_TIME_WINDOW_MINUTES

        peak_start = dify_config.UPLOAD_PEAK_HOURS_START
        peak_end = dify_config.UPLOAD_PEAK_HOURS_END

        try:
            self.peak_hours_start = time.fromisoformat(peak_start)
            self.peak_hours_end = time.fromisoformat(peak_end)
        except ValueError:
            self.peak_hours_start = None
            self.peak_hours_end = None

        # Rate limits during peak/off-peak hours
        self.peak_rate_limit = dify_config.UPLOAD_PEAK_RATE_LIMIT
        self.off_peak_rate_limit = dify_config.UPLOAD_OFF_PEAK_RATE_LIMIT

        # Queue settings
        self.max_queue_size = dify_config.UPLOAD_MAX_QUEUE_SIZE
        self.queue_processing_batch_size = dify_config.UPLOAD_BATCH_SIZE


# Global instance
upload_scheduler_config = UploadSchedulerConfig()

UPLOAD_SCHEDULER_BEAT_CONFIG = {
    'process_upload_queue_task': {
        'task': 'process_upload_queue_task',
        'schedule': crontab(minute='*'),
    }
} if upload_scheduler_config.enabled else {}

DEFAULT_RATE_LIMITS = {
    'max_uploads_per_window': upload_scheduler_config.max_uploads_per_window,
    'time_window_minutes': upload_scheduler_config.time_window_minutes,
    'peak_rate_limit': upload_scheduler_config.peak_rate_limit,
    'off_peak_rate_limit': upload_scheduler_config.off_peak_rate_limit,
    'max_queue_size': upload_scheduler_config.max_queue_size,
    'batch_size': upload_scheduler_config.queue_processing_batch_size,
} 