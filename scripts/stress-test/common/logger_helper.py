#!/usr/bin/env python3

import sys
import time
from enum import Enum


class LogLevel(Enum):
    """Log levels with associated colors and symbols."""

    DEBUG = ("🔍", "\033[90m")  # Gray
    INFO = ("ℹ️ ", "\033[94m")  # Blue
    SUCCESS = ("✅", "\033[92m")  # Green
    WARNING = ("⚠️ ", "\033[93m")  # Yellow
    ERROR = ("❌", "\033[91m")  # Red
    STEP = ("🚀", "\033[96m")  # Cyan
    PROGRESS = ("📋", "\033[95m")  # Magenta


class Logger:
    """Logger class for formatted console output."""

    def __init__(self, name: str | None = None, use_colors: bool = True):
        """Initialize logger.

        Args:
            name: Optional name for the logger (e.g., script name)
            use_colors: Whether to use ANSI color codes
        """
        self.name = name
        self.use_colors = use_colors and sys.stdout.isatty()
        self._reset_color = "\033[0m" if self.use_colors else ""

    def _format_message(self, level: LogLevel, message: str, indent: int = 0) -> str:
        """Format a log message with level, color, and indentation.

        Args:
            level: Log level
            message: Message to log
            indent: Number of spaces to indent

        Returns:
            Formatted message string
        """
        symbol, color = level.value
        color = color if self.use_colors else ""
        reset = self._reset_color

        prefix = " " * indent

        if self.name and level in [LogLevel.STEP, LogLevel.ERROR]:
            return f"{prefix}{color}{symbol} [{self.name}] {message}{reset}"
        else:
            return f"{prefix}{color}{symbol} {message}{reset}"

    def debug(self, message: str, indent: int = 0) -> None:
        """Log debug message."""
        print(self._format_message(LogLevel.DEBUG, message, indent))

    def info(self, message: str, indent: int = 0) -> None:
        """Log info message."""
        print(self._format_message(LogLevel.INFO, message, indent))

    def success(self, message: str, indent: int = 0) -> None:
        """Log success message."""
        print(self._format_message(LogLevel.SUCCESS, message, indent))

    def warning(self, message: str, indent: int = 0) -> None:
        """Log warning message."""
        print(self._format_message(LogLevel.WARNING, message, indent))

    def error(self, message: str, indent: int = 0) -> None:
        """Log error message."""
        print(self._format_message(LogLevel.ERROR, message, indent), file=sys.stderr)

    def step(self, message: str, indent: int = 0) -> None:
        """Log a step in a process."""
        print(self._format_message(LogLevel.STEP, message, indent))

    def progress(self, message: str, indent: int = 0) -> None:
        """Log progress information."""
        print(self._format_message(LogLevel.PROGRESS, message, indent))

    def separator(self, char: str = "-", length: int = 60) -> None:
        """Print a separator line."""
        print(char * length)

    def header(self, title: str, width: int = 60) -> None:
        """Print a formatted header."""
        if self.use_colors:
            print(f"\n\033[1m{'=' * width}\033[0m")  # Bold
            print(f"\033[1m{title.center(width)}\033[0m")
            print(f"\033[1m{'=' * width}\033[0m\n")
        else:
            print(f"\n{'=' * width}")
            print(title.center(width))
            print(f"{'=' * width}\n")

    def box(self, title: str, width: int = 60) -> None:
        """Print a title in a box."""
        border = "═" * (width - 2)
        if self.use_colors:
            print(f"\033[1m╔{border}╗\033[0m")
            print(f"\033[1m║{title.center(width - 2)}║\033[0m")
            print(f"\033[1m╚{border}╝\033[0m")
        else:
            print(f"╔{border}╗")
            print(f"║{title.center(width - 2)}║")
            print(f"╚{border}╝")

    def list_item(self, item: str, indent: int = 2) -> None:
        """Print a list item."""
        prefix = " " * indent
        print(f"{prefix}• {item}")

    def key_value(self, key: str, value: str, indent: int = 2) -> None:
        """Print a key-value pair."""
        prefix = " " * indent
        if self.use_colors:
            print(f"{prefix}\033[1m{key}:\033[0m {value}")
        else:
            print(f"{prefix}{key}: {value}")

    def spinner_start(self, message: str) -> None:
        """Start a spinner (simple implementation)."""
        sys.stdout.write(f"\r{message}... ")
        sys.stdout.flush()

    def spinner_stop(self, success: bool = True, message: str | None = None) -> None:
        """Stop the spinner and show result."""
        if success:
            symbol = "✅" if message else "Done"
            sys.stdout.write(f"\r{symbol} {message or ''}\n")
        else:
            symbol = "❌" if message else "Failed"
            sys.stdout.write(f"\r{symbol} {message or ''}\n")
        sys.stdout.flush()


class ProgressLogger:
    """Logger for tracking progress through multiple steps."""

    def __init__(self, total_steps: int, logger: Logger | None = None):
        """Initialize progress logger.

        Args:
            total_steps: Total number of steps
            logger: Logger instance to use (creates new if None)
        """
        self.total_steps = total_steps
        self.current_step = 0
        self.logger = logger or Logger()
        self.start_time = time.time()

    def next_step(self, description: str) -> None:
        """Move to next step and log it."""
        self.current_step += 1
        elapsed = time.time() - self.start_time

        if self.logger.use_colors:
            progress_bar = self._create_progress_bar()
            print(f"\n\033[1m[Step {self.current_step}/{self.total_steps}]\033[0m {progress_bar}")
            self.logger.step(f"{description} (Elapsed: {elapsed:.1f}s)")
        else:
            print(f"\n[Step {self.current_step}/{self.total_steps}]")
            self.logger.step(f"{description} (Elapsed: {elapsed:.1f}s)")

    def _create_progress_bar(self, width: int = 20) -> str:
        """Create a simple progress bar."""
        filled = int(width * self.current_step / self.total_steps)
        bar = "█" * filled + "░" * (width - filled)
        percentage = int(100 * self.current_step / self.total_steps)
        return f"[{bar}] {percentage}%"

    def complete(self) -> None:
        """Mark progress as complete."""
        elapsed = time.time() - self.start_time
        self.logger.success(f"All steps completed! Total time: {elapsed:.1f}s")


# Create default logger instance
logger = Logger()


# Convenience functions using default logger
def debug(message: str, indent: int = 0) -> None:
    """Log debug message using default logger."""
    logger.debug(message, indent)


def info(message: str, indent: int = 0) -> None:
    """Log info message using default logger."""
    logger.info(message, indent)


def success(message: str, indent: int = 0) -> None:
    """Log success message using default logger."""
    logger.success(message, indent)


def warning(message: str, indent: int = 0) -> None:
    """Log warning message using default logger."""
    logger.warning(message, indent)


def error(message: str, indent: int = 0) -> None:
    """Log error message using default logger."""
    logger.error(message, indent)


def step(message: str, indent: int = 0) -> None:
    """Log step using default logger."""
    logger.step(message, indent)


def progress(message: str, indent: int = 0) -> None:
    """Log progress using default logger."""
    logger.progress(message, indent)
