"""
UI Layout Service for Dify.

This module provides utilities for managing UI layout state, form rendering,
and responsive design calculations for the Dify web application.

Key Features:
- Form layout management and validation
- Responsive width calculations
- Layout state persistence
- Component visibility management
- Dynamic form field rendering
- Layout adaptation for different contexts

Related Issue: #17603 - Form width adaptation in template conversion
"""

from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, Field, field_validator


class LayoutMode(StrEnum):
    """Layout modes for UI components."""

    COMPACT = "compact"
    STANDARD = "standard"
    EXPANDED = "expanded"
    FULLSCREEN = "fullscreen"


class FormFieldType(StrEnum):
    """Types of form fields."""

    TEXT = "text"
    TEXTAREA = "textarea"
    NUMBER = "number"
    SELECT = "select"
    MULTISELECT = "multiselect"
    CHECKBOX = "checkbox"
    RADIO = "radio"
    FILE = "file"
    DATE = "date"
    DATETIME = "datetime"
    COLOR = "color"
    SLIDER = "slider"
    SWITCH = "switch"
    JSON = "json"
    CODE = "code"
    MARKDOWN = "markdown"


class ResponsiveBreakpoint(StrEnum):
    """Responsive design breakpoints."""

    XS = "xs"
    SM = "sm"
    MD = "md"
    LG = "lg"
    XL = "xl"
    XXL = "xxl"


@dataclass
class BreakpointConfig:
    """Configuration for a responsive breakpoint."""

    name: ResponsiveBreakpoint
    min_width: int
    max_width: int | None
    columns: int
    gutter: int
    margin: int

    def matches(self, width: int) -> bool:
        """Check if width matches this breakpoint."""
        if self.max_width is None:
            return width >= self.min_width
        return self.min_width <= width < self.max_width


@dataclass
class FormFieldConfig:
    """Configuration for a form field."""

    name: str
    field_type: FormFieldType
    label: str
    required: bool = False
    placeholder: str = ""
    default_value: Any = None
    options: list[dict[str, Any]] = field(default_factory=list)
    validation_rules: dict[str, Any] = field(default_factory=dict)
    width: str = "100%"
    min_width: int = 0
    max_width: int | None = None
    visible: bool = True
    disabled: bool = False
    help_text: str = ""
    order: int = 0

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary."""
        return {
            "name": self.name,
            "type": self.field_type.value,
            "label": self.label,
            "required": self.required,
            "placeholder": self.placeholder,
            "default_value": self.default_value,
            "options": self.options,
            "validation_rules": self.validation_rules,
            "width": self.width,
            "min_width": self.min_width,
            "max_width": self.max_width,
            "visible": self.visible,
            "disabled": self.disabled,
            "help_text": self.help_text,
            "order": self.order,
        }


@dataclass
class LayoutState:
    """Current state of a layout."""

    mode: LayoutMode
    width: int
    height: int
    breakpoint: ResponsiveBreakpoint
    sidebar_visible: bool = True
    sidebar_width: int = 280
    header_height: int = 64
    footer_height: int = 0
    content_padding: int = 24
    form_fields: list[FormFieldConfig] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)

    def get_content_width(self) -> int:
        """Calculate available content width."""
        sidebar = self.sidebar_width if self.sidebar_visible else 0
        return max(0, self.width - sidebar - (self.content_padding * 2))

    def get_content_height(self) -> int:
        """Calculate available content height."""
        return max(0, self.height - self.header_height - self.footer_height - (self.content_padding * 2))

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary."""
        return {
            "mode": self.mode.value,
            "width": self.width,
            "height": self.height,
            "breakpoint": self.breakpoint.value,
            "sidebar_visible": self.sidebar_visible,
            "sidebar_width": self.sidebar_width,
            "header_height": self.header_height,
            "footer_height": self.footer_height,
            "content_padding": self.content_padding,
            "content_width": self.get_content_width(),
            "content_height": self.get_content_height(),
            "form_fields": [f.to_dict() for f in self.form_fields],
            "metadata": self.metadata,
        }


class LayoutConfig(BaseModel):
    """Configuration for layout management."""

    default_mode: LayoutMode = LayoutMode.STANDARD
    min_content_width: int = Field(default=320, ge=200, le=800)
    max_content_width: int = Field(default=1200, ge=400, le=2400)
    sidebar_collapsible: bool = True
    sidebar_default_visible: bool = True
    sidebar_min_width: int = Field(default=200, ge=100, le=400)
    sidebar_max_width: int = Field(default=400, ge=200, le=600)
    form_field_min_width: int = Field(default=200, ge=100, le=400)
    form_field_gap: int = Field(default=16, ge=0, le=48)
    preserve_form_width: bool = True

    @field_validator("max_content_width")
    @classmethod
    def validate_max_width(cls, v: int, info: Any) -> int:
        """Ensure max width is greater than min width."""
        min_width = info.data.get("min_content_width", 320)
        if v < min_width:
            raise ValueError("max_content_width must be >= min_content_width")
        return v


class UILayoutService:
    """
    Service for managing UI layout and form rendering.

    This service provides utilities for responsive layout management,
    form field configuration, and layout state persistence.
    """

    # Default breakpoint configurations
    DEFAULT_BREAKPOINTS = [
        BreakpointConfig(ResponsiveBreakpoint.XS, 0, 576, 1, 8, 16),
        BreakpointConfig(ResponsiveBreakpoint.SM, 576, 768, 2, 12, 24),
        BreakpointConfig(ResponsiveBreakpoint.MD, 768, 992, 2, 16, 32),
        BreakpointConfig(ResponsiveBreakpoint.LG, 992, 1200, 3, 20, 40),
        BreakpointConfig(ResponsiveBreakpoint.XL, 1200, 1400, 4, 24, 48),
        BreakpointConfig(ResponsiveBreakpoint.XXL, 1400, None, 4, 24, 64),
    ]

    def __init__(self, config: LayoutConfig | None = None):
        self.config = config or LayoutConfig()
        self._breakpoints = self.DEFAULT_BREAKPOINTS.copy()
        self._layout_states: dict[str, LayoutState] = {}

    def get_breakpoint(self, width: int) -> ResponsiveBreakpoint:
        """
        Get the responsive breakpoint for a given width.

        Args:
            width: The viewport width in pixels

        Returns:
            The matching ResponsiveBreakpoint
        """
        for bp in reversed(self._breakpoints):
            if bp.matches(width):
                return bp.name
        return ResponsiveBreakpoint.XS

    def get_breakpoint_config(self, breakpoint: ResponsiveBreakpoint) -> BreakpointConfig | None:
        """Get configuration for a specific breakpoint."""
        for bp in self._breakpoints:
            if bp.name == breakpoint:
                return bp
        return None

    def calculate_form_field_width(
        self,
        container_width: int,
        field_config: FormFieldConfig,
        num_columns: int = 1,
    ) -> int:
        """
        Calculate the optimal width for a form field.

        Args:
            container_width: Available container width
            field_config: The field configuration
            num_columns: Number of columns in the form layout

        Returns:
            Calculated field width in pixels
        """
        # Calculate base width per column
        gap_total = self.config.form_field_gap * (num_columns - 1)
        available = container_width - gap_total
        base_width = available // num_columns

        # Apply field-specific constraints
        width = base_width
        if field_config.min_width > 0:
            width = max(width, field_config.min_width)
        if field_config.max_width is not None:
            width = min(width, field_config.max_width)

        # Ensure minimum usable width
        width = max(width, self.config.form_field_min_width)

        return width

    def calculate_form_layout(
        self,
        container_width: int,
        fields: list[FormFieldConfig],
    ) -> list[list[FormFieldConfig]]:
        """
        Calculate optimal form layout based on container width.

        Args:
            container_width: Available container width
            fields: List of form field configurations

        Returns:
            List of rows, each containing fields for that row
        """
        breakpoint = self.get_breakpoint(container_width)
        bp_config = self.get_breakpoint_config(breakpoint)
        num_columns = bp_config.columns if bp_config else 1

        # Sort fields by order
        sorted_fields = sorted([f for f in fields if f.visible], key=lambda f: f.order)

        rows: list[list[FormFieldConfig]] = []
        current_row: list[FormFieldConfig] = []
        current_width = 0

        for field_config in sorted_fields:
            field_width = self.calculate_form_field_width(container_width, field_config, num_columns)

            # Check if field fits in current row
            if current_width + field_width + self.config.form_field_gap <= container_width:
                current_row.append(field_config)
                current_width += field_width + self.config.form_field_gap
            else:
                # Start new row
                if current_row:
                    rows.append(current_row)
                current_row = [field_config]
                current_width = field_width

        # Add last row
        if current_row:
            rows.append(current_row)

        return rows

    def create_layout_state(
        self,
        layout_id: str,
        width: int,
        height: int,
        fields: list[FormFieldConfig] | None = None,
    ) -> LayoutState:
        """
        Create a new layout state.

        Args:
            layout_id: Unique identifier for the layout
            width: Viewport width
            height: Viewport height
            fields: Optional list of form fields

        Returns:
            New LayoutState instance
        """
        breakpoint = self.get_breakpoint(width)

        # Determine layout mode based on width
        if width < 576:
            mode = LayoutMode.COMPACT
        elif width < 992:
            mode = LayoutMode.STANDARD
        elif width < 1400:
            mode = LayoutMode.EXPANDED
        else:
            mode = LayoutMode.FULLSCREEN

        state = LayoutState(
            mode=mode,
            width=width,
            height=height,
            breakpoint=breakpoint,
            sidebar_visible=self.config.sidebar_default_visible and width >= 768,
            form_fields=fields or [],
        )

        self._layout_states[layout_id] = state
        return state

    def update_layout_state(
        self,
        layout_id: str,
        width: int | None = None,
        height: int | None = None,
        sidebar_visible: bool | None = None,
    ) -> LayoutState | None:
        """
        Update an existing layout state.

        Args:
            layout_id: The layout identifier
            width: New viewport width
            height: New viewport height
            sidebar_visible: New sidebar visibility

        Returns:
            Updated LayoutState or None if not found
        """
        state = self._layout_states.get(layout_id)
        if not state:
            return None

        if width is not None:
            state.width = width
            state.breakpoint = self.get_breakpoint(width)

        if height is not None:
            state.height = height

        if sidebar_visible is not None:
            state.sidebar_visible = sidebar_visible

        return state

    def get_layout_state(self, layout_id: str) -> LayoutState | None:
        """Get a layout state by ID."""
        return self._layout_states.get(layout_id)

    def delete_layout_state(self, layout_id: str) -> bool:
        """Delete a layout state."""
        if layout_id in self._layout_states:
            del self._layout_states[layout_id]
            return True
        return False

    def adapt_form_width(
        self,
        original_width: int,
        new_container_width: int,
        preserve_ratio: bool = True,
    ) -> int:
        """
        Adapt form width when container size changes.

        This addresses the issue where form width doesn't adapt properly
        when switching between conversations.

        Args:
            original_width: Original form width
            new_container_width: New container width
            preserve_ratio: Whether to preserve width ratio

        Returns:
            Adapted form width
        """
        if not self.config.preserve_form_width:
            return new_container_width

        if preserve_ratio and original_width > 0:
            # Calculate ratio and apply to new width
            ratio = min(1.0, original_width / self.config.max_content_width)
            adapted = int(new_container_width * ratio)
        else:
            adapted = new_container_width

        # Apply constraints
        adapted = max(adapted, self.config.min_content_width)
        adapted = min(adapted, self.config.max_content_width)
        adapted = min(adapted, new_container_width)

        return adapted

    def get_responsive_styles(self, width: int) -> dict[str, Any]:
        """
        Get responsive CSS-like styles for a given width.

        Args:
            width: Viewport width

        Returns:
            Dictionary of style properties
        """
        breakpoint = self.get_breakpoint(width)
        bp_config = self.get_breakpoint_config(breakpoint)

        if not bp_config:
            return {}

        return {
            "breakpoint": breakpoint.value,
            "columns": bp_config.columns,
            "gutter": f"{bp_config.gutter}px",
            "margin": f"{bp_config.margin}px",
            "container_max_width": f"{self.config.max_content_width}px",
            "sidebar_width": f"{self.config.sidebar_min_width}px" if width < 992 else f"{280}px",
        }

    def create_form_field(
        self,
        name: str,
        field_type: FormFieldType | str,
        label: str,
        **kwargs: Any,
    ) -> FormFieldConfig:
        """
        Create a form field configuration.

        Args:
            name: Field name
            field_type: Type of field
            label: Display label
            **kwargs: Additional field options

        Returns:
            FormFieldConfig instance
        """
        if isinstance(field_type, str):
            field_type = FormFieldType(field_type)

        return FormFieldConfig(
            name=name,
            field_type=field_type,
            label=label,
            required=kwargs.get("required", False),
            placeholder=kwargs.get("placeholder", ""),
            default_value=kwargs.get("default_value"),
            options=kwargs.get("options", []),
            validation_rules=kwargs.get("validation_rules", {}),
            width=kwargs.get("width", "100%"),
            min_width=kwargs.get("min_width", 0),
            max_width=kwargs.get("max_width"),
            visible=kwargs.get("visible", True),
            disabled=kwargs.get("disabled", False),
            help_text=kwargs.get("help_text", ""),
            order=kwargs.get("order", 0),
        )

    def validate_form_data(
        self,
        fields: list[FormFieldConfig],
        data: dict[str, Any],
    ) -> tuple[bool, list[str]]:
        """
        Validate form data against field configurations.

        Args:
            fields: List of field configurations
            data: Form data to validate

        Returns:
            Tuple of (is_valid, list of error messages)
        """
        errors: list[str] = []

        for field_config in fields:
            if not field_config.visible:
                continue

            value = data.get(field_config.name)

            # Check required
            if field_config.required and (value is None or value == ""):
                errors.append(f"{field_config.label} is required")
                continue

            # Skip further validation if empty and not required
            if value is None or value == "":
                continue

            # Type-specific validation
            if field_config.field_type == FormFieldType.NUMBER:
                try:
                    float(value)
                except (ValueError, TypeError):
                    errors.append(f"{field_config.label} must be a number")

            # Custom validation rules
            rules = field_config.validation_rules
            if "min_length" in rules and len(str(value)) < rules["min_length"]:
                errors.append(f"{field_config.label} must be at least {rules['min_length']} characters")
            if "max_length" in rules and len(str(value)) > rules["max_length"]:
                errors.append(f"{field_config.label} must be at most {rules['max_length']} characters")

        return len(errors) == 0, errors

    @classmethod
    def create_default(cls) -> "UILayoutService":
        """Create service with default configuration."""
        return cls(config=LayoutConfig())

    @classmethod
    def create_for_mobile(cls) -> "UILayoutService":
        """Create service optimized for mobile layouts."""
        config = LayoutConfig(
            default_mode=LayoutMode.COMPACT,
            min_content_width=280,
            max_content_width=600,
            sidebar_default_visible=False,
            form_field_min_width=150,
        )
        return cls(config=config)
