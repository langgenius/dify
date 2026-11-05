#!/bin/bash

# ================================================================
# Dify Environment Variables Synchronization Script
#
# Features:
# - Synchronize latest settings from .env.example to .env
# - Preserve custom settings in existing .env
# - Add new environment variables
# - Report additional local overrides
# - Create backup files
# ================================================================

set -eo pipefail  # Exit on error and pipe failures (safer for complex variable handling)

# Error handling function
# Arguments:
#   $1 - Line number where error occurred
#   $2 - Error code
handle_error() {
    local line_no=$1
    local error_code=$2
    echo -e "\033[0;31m[ERROR]\033[0m Script error: line $line_no with error code $error_code" >&2
    echo -e "\033[0;31m[ERROR]\033[0m Debug info: current working directory $(pwd)" >&2
    exit $error_code
}

# Set error trap
trap 'handle_error ${LINENO} $?' ERR

# Color settings for output
readonly RED='\033[0;31m'
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[1;33m'
readonly BLUE='\033[0;34m'
readonly NC='\033[0m' # No Color

# Logging functions
# Print informational message in blue
# Arguments: $1 - Message to print
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

# Print success message in green
# Arguments: $1 - Message to print
log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

# Print warning message in yellow
# Arguments: $1 - Message to print
log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1" >&2
}

# Print error message in red to stderr
# Arguments: $1 - Message to print
log_error() {
    echo -e "${RED}[ERROR]${NC} $1" >&2
}

# Check for required files and create .env if missing
# Verifies that .env.example exists and creates .env from template if needed
check_files() {
    log_info "Checking required files..."

    if [[ ! -f ".env.example" ]]; then
        log_error ".env.example file not found"
        exit 1
    fi

    if [[ ! -f ".env" ]]; then
        log_warning ".env file does not exist. Creating from .env.example."
        cp ".env.example" ".env"
        log_success ".env file created"
    fi

    log_success "Required files verified"
}

# Create timestamped backup of .env file
# Creates env-backup directory if needed and backs up current .env file
create_backup() {
    local timestamp
    timestamp=$(date +"%Y%m%d_%H%M%S")
    local backup_dir="env-backup"

    # Create backup directory if it doesn't exist
    if [[ ! -d "$backup_dir" ]]; then
        mkdir -p "$backup_dir"
        log_info "Created backup directory: $backup_dir"
    fi

    if [[ -f ".env" ]]; then
        local backup_file="${backup_dir}/.env.backup_${timestamp}"
        cp ".env" "$backup_file"
        log_success "Backed up existing .env to $backup_file"
    fi
}

# Detect differences between .env and .env.example (optimized for large files)
detect_differences() {
    log_info "Detecting differences between .env and .env.example..."

    # Create secure temporary directory
    local temp_dir
    temp_dir=$(mktemp -d)
    local temp_diff="$temp_dir/env_diff"

    # Store diff file path as global variable
    DIFF_FILE="$temp_diff"
    TEMP_DIR="$temp_dir"

    # Initialize difference file
    : > "$temp_diff"

    # Use awk for efficient comparison (much faster for large files)
    local diff_count
    diff_count=$(awk -F= '
    BEGIN { OFS="\x01" }
    FNR==NR {
        if (!/^[[:space:]]*#/ && !/^[[:space:]]*$/ && /=/) {
            gsub(/^[[:space:]]+|[[:space:]]+$/, "", $1)
            key = $1
            value = substr($0, index($0,"=")+1)
            gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
            env_values[key] = value
        }
        next
    }
    {
        if (!/^[[:space:]]*#/ && !/^[[:space:]]*$/ && /=/) {
            gsub(/^[[:space:]]+|[[:space:]]+$/, "", $1)
            key = $1
            example_value = substr($0, index($0,"=")+1)
            gsub(/^[[:space:]]+|[[:space:]]+$/, "", example_value)

            if (key in env_values && env_values[key] != example_value) {
                print key, env_values[key], example_value > "'$temp_diff'"
                diff_count++
            }
        }
    }
    END { print diff_count }
    ' .env .env.example)

    if [[ $diff_count -gt 0 ]]; then
        log_success "Detected differences in $diff_count environment variables"
        # Show detailed differences
        show_differences_detail
    else
        log_info "No differences detected"
    fi
}

# Parse environment variable line
# Extracts key-value pairs from .env file format lines
# Arguments:
#   $1 - Line to parse
# Returns:
#   0 - Success, outputs "key|value" format
#   1 - Skip (empty line, comment, or invalid format)
parse_env_line() {
    local line="$1"
    local key=""
    local value=""

    # Skip empty lines or comment lines
    [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && return 1

    # Split by =
    if [[ "$line" =~ ^([^=]+)=(.*)$ ]]; then
        key="${BASH_REMATCH[1]}"
        value="${BASH_REMATCH[2]}"

        # Remove leading and trailing whitespace
        key=$(echo "$key" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')
        value=$(echo "$value" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')

        if [[ -n "$key" ]]; then
            echo "$key|$value"
            return 0
        fi
    fi

    return 1
}

# Show detailed differences
show_differences_detail() {
    log_info ""
    log_info "=== Environment Variable Differences ==="

    # Read differences from the already created diff file
    if [[ ! -s "$DIFF_FILE" ]]; then
        log_info "No differences to display"
        return
    fi

    # Display differences
    local count=1
    while IFS=$'\x01' read -r key env_value example_value; do
        echo ""
        echo -e "${YELLOW}[$count] $key${NC}"
        echo -e "  ${GREEN}.env (current)${NC}      : ${env_value}"
        echo -e "  ${BLUE}.env.example (recommended)${NC}: ${example_value}"

        # Analyze value changes
        analyze_value_change "$env_value" "$example_value"
        ((count++))
    done < "$DIFF_FILE"

    echo ""
    log_info "=== Difference Analysis Complete ==="
    log_info "Note: Consider changing to the recommended values above."
    log_info "Current implementation preserves .env values."
    echo ""
}

# Analyze value changes
analyze_value_change() {
    local current_value="$1"
    local recommended_value="$2"

    # Analyze value characteristics
    local analysis=""

    # Empty value check
    if [[ -z "$current_value" && -n "$recommended_value" ]]; then
        analysis="  ${RED}→ Setting from empty to recommended value${NC}"
    elif [[ -n "$current_value" && -z "$recommended_value" ]]; then
        analysis="  ${RED}→ Recommended value changed to empty${NC}"
    # Numeric check - using arithmetic evaluation for robust comparison
    elif [[ "$current_value" =~ ^[0-9]+$ && "$recommended_value" =~ ^[0-9]+$ ]]; then
        # Use arithmetic evaluation to handle leading zeros correctly
        if (( 10#$current_value < 10#$recommended_value )); then
            analysis="  ${BLUE}→ Numeric increase (${current_value} < ${recommended_value})${NC}"
        elif (( 10#$current_value > 10#$recommended_value )); then
            analysis="  ${YELLOW}→ Numeric decrease (${current_value} > ${recommended_value})${NC}"
        fi
    # Boolean check
    elif [[ "$current_value" =~ ^(true|false)$ && "$recommended_value" =~ ^(true|false)$ ]]; then
        if [[ "$current_value" != "$recommended_value" ]]; then
            analysis="  ${BLUE}→ Boolean value change (${current_value} → ${recommended_value})${NC}"
        fi
    # URL/endpoint check
    elif [[ "$current_value" =~ ^https?:// || "$recommended_value" =~ ^https?:// ]]; then
        analysis="  ${BLUE}→ URL/endpoint change${NC}"
    # File path check
    elif [[ "$current_value" =~ ^/ || "$recommended_value" =~ ^/ ]]; then
        analysis="  ${BLUE}→ File path change${NC}"
    else
        # Length comparison
        local current_len=${#current_value}
        local recommended_len=${#recommended_value}
        if [[ $current_len -ne $recommended_len ]]; then
            analysis="  ${YELLOW}→ String length change (${current_len} → ${recommended_len} characters)${NC}"
        fi
    fi

    if [[ -n "$analysis" ]]; then
        echo -e "$analysis"
    fi
}

# Append missing template inputs without rewriting existing overrides or comments.
sync_env_file() {
    log_info "Synchronizing new deployment inputs into .env..."

    local new_env_file=".env.new"
    cp .env "$new_env_file"
    awk -F= '
    FILENAME == ARGV[1] {
        if (/^[[:space:]]*[A-Za-z_][A-Za-z0-9_]*[[:space:]]*=/) {
            key = $1
            gsub(/^[[:space:]]+|[[:space:]]+$/, "", key)
            existing[key] = 1
        }
        next
    }
    /^[[:space:]]*[A-Za-z_][A-Za-z0-9_]*[[:space:]]*=/ {
        key = $1
        gsub(/^[[:space:]]+|[[:space:]]+$/, "", key)
        if (!(key in existing)) {
            if (!added++) print "\n# New deployment inputs from .env.example"
            print $0
            existing[key] = 1
        }
    }
    ' .env .env.example >> "$new_env_file"

    if ! mv "$new_env_file" .env; then
        log_error "Failed to replace .env file"
        rm -f "$new_env_file"
        return 1
    fi

    if [[ -n "${TEMP_DIR:-}" ]]; then
        rm -rf "${TEMP_DIR}"
        unset TEMP_DIR
    fi
    unset DIFF_FILE

    log_success "Synchronization completed; existing .env settings preserved"
}

# Report additional local overrides
detect_removed_variables() {
    log_info "Checking for additional local overrides..."

    if [[ ! -f ".env" ]]; then
        return
    fi

    # Use temporary files for efficient lookup
    local temp_dir="${TEMP_DIR:-$(mktemp -d)}"
    local temp_example_keys="$temp_dir/example_keys"
    local temp_current_keys="$temp_dir/current_keys"
    local cleanup_temp_dir=""

    # Set flag if we created a new temp directory
    if [[ -z "${TEMP_DIR:-}" ]]; then
        cleanup_temp_dir="$temp_dir"
    fi

    # Get keys from .env.example and .env, sorted for comm
    awk -F= '!/^[[:space:]]*#/ && /=/ {gsub(/^[[:space:]]+|[[:space:]]+$/, "", $1); print $1}' .env.example | sort > "$temp_example_keys"
    awk -F= '!/^[[:space:]]*#/ && /=/ {gsub(/^[[:space:]]+|[[:space:]]+$/, "", $1); print $1}' .env | sort > "$temp_current_keys"

    # Get keys from existing .env and check for removals
    local removed_vars=()
    while IFS= read -r var; do
        removed_vars+=("$var")
    done < <(comm -13 "$temp_example_keys" "$temp_current_keys")

    # Clean up temporary files if we created a new temp directory
    if [[ -n "$cleanup_temp_dir" ]]; then
        rm -rf "$cleanup_temp_dir"
    fi

    if [[ ${#removed_vars[@]} -gt 0 ]]; then
        log_warning "The following local overrides are not listed in .env.example:"
        for var in "${removed_vars[@]}"; do
            log_warning "  - $var"
        done
        log_warning "These overrides will be preserved in .env"
    else
        log_success "No additional local overrides found"
    fi
}

# Show statistics
show_statistics() {
    log_info "Synchronization statistics:"

    local total_example total_env
    total_example=$(grep -c "^[^#]*=" .env.example 2>/dev/null || echo "0")
    total_env=$(grep -c "^[^#]*=" .env 2>/dev/null || echo "0")

    log_info "  .env.example environment variables: $total_example"
    log_info "  .env environment variables: $total_env"
}

# Main execution function
# Orchestrates the complete synchronization process in the correct order
main() {
    log_info "=== Dify Environment Variables Synchronization Script ==="
    log_info "Execution started: $(date)"

    # Check prerequisites
    check_files

    # Create backup
    create_backup

    # Detect differences
    detect_differences

    # Report additional local overrides (before sync)
    detect_removed_variables

    # Synchronize environment file
    sync_env_file

    # Show statistics
    show_statistics

    log_success "=== Synchronization process completed successfully ==="
    log_info "Execution finished: $(date)"
}

# Execute main function only when script is run directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi
