#!/usr/bin/env bash
set -euo pipefail

# Dify One-Click Installer
# Usage:
#   ./install.sh                    # Interactive configuration (recommended)
#   ./install.sh --yes              # Use all recommended defaults (no interaction)
#   ./install.sh --help             # Show help
#   curl -sSL https://raw.githubusercontent.com/langgenius/dify/main/docker/install.sh | bash
#
# Features:
#   - Curl one-liner installation
#   - Auto-shallow-clones repository if needed
#   - Interactive mode with smart defaults
#   - Database selection (PostgreSQL/MySQL)
#   - Vector database selection (Weaviate/Qdrant/Milvus/Chroma/pgvector)
#   - Storage selection (Local/S3/Azure/GCS/Aliyun)
#   - Domain and HTTPS configuration (with nginx and certbot)
#   - Email service configuration (SMTP/Gmail/SendGrid/Resend)

# Configuration defaults - these need to be first for testing
INTERACTIVE=true
YES_MODE=false
DEPLOY_TYPE="private"  # "private" (localhost/IP) or "public" (domain with SSL)
DOMAIN="localhost"
HTTP_PORT="80"
HTTPS_PORT="443"
NGINX_HTTPS_ENABLED=false
NGINX_SERVER_NAME="_"
NGINX_ENABLE_CERTBOT_CHALLENGE=false
CERTBOT_EMAIL=""
DB_TYPE="postgresql"
VECTOR_STORE="weaviate"
STORAGE_TYPE="opendal"
OPENDAL_SCHEME="fs"
CONFIGURE_EMAIL=false

# GitHub repository configuration
GITHUB_REPO="langgenius/dify"
GITHUB_BRANCH="main"

# ============================================
# Early help check - do this before anything else
# ============================================
show_help() {
    echo "Dify One-Click Installer"
    echo ""
    echo "Usage:"
    echo "  curl -sSL https://raw.githubusercontent.com/langgenius/dify/main/docker/install.sh | bash"
    echo "                                      # Interactive mode (recommended)"
    echo ""
    echo "  ./install.sh                    # Interactive configuration (if already have files)"
    echo "  ./install.sh --yes              # Use all recommended defaults (quick)"
    echo "  ./install.sh -y                  # Short form"
    echo "  ./install.sh --help             # Show this help"
    echo ""
    echo "Curl one-liner examples:"
    echo "  curl -sSL https://raw.githubusercontent.com/langgenius/dify/main/docker/install.sh | bash"
    echo "  curl -sSL https://raw.githubusercontent.com/langgenius/dify/main/docker/install.sh | bash -s -- --yes"
    echo ""
    echo "What it does:"
    echo "  - Shallow clones Dify repository if needed"
    echo "  - Checks system requirements"
    echo "  - Guides you through configuration"
    echo "  - Generates secure secrets"
    echo "  - Starts Dify services"
    echo ""
}

# Check for help first
for arg in "$@"; do
    if [ "$arg" = "--help" ] || [ "$arg" = "-h" ]; then
        show_help
        exit 0
    fi
done

# Storage config variables (global scope)
S3_BUCKET=""
S3_REGION=""
S3_ACCESS_KEY=""
S3_SECRET_KEY=""
AZURE_ACCOUNT=""
AZURE_KEY=""
AZURE_CONTAINER=""
GCS_BUCKET=""
GCS_PROJECT=""
ALIYUN_BUCKET=""
ALIYUN_REGION=""
ALIYUN_ACCESS_KEY=""
ALIYUN_SECRET_KEY=""

# Email config variables (global scope)
SMTP_HOST=""
SMTP_PORT=""
SMTP_USER=""
SMTP_PASSWORD=""
SMTP_FROM=""

# ============================================
# Early function definitions (needed for setup)
# ============================================

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m'

# Print functions
print_header() {
    echo ""
    echo -e "${BLUE}┌─────────────────────────────────────────────────────┐${NC}"
    echo -e "${BLUE}│  Dify One-Click Installer                           │${NC}"
    echo -e "${BLUE}└─────────────────────────────────────────────────────┘${NC}"
    echo ""
}

print_ok() { echo -e "${GREEN}✓${NC} $1"; }
print_warn() { echo -e "${YELLOW}⚠${NC}  $1"; }
print_error() { echo -e "${RED}✗${NC} $1"; }
print_step() { echo -e "${PURPLE}➜${NC} $1"; }
print_section() { echo ""; echo -e "${CYAN}─── $1 ─────────────────────────────────────────────${NC}"; echo ""; }

# Check if a directory is safe to use (owned by current user or root)
is_safe_directory() {
    local dir="$1"
    if [ ! -d "$dir" ]; then
        return 0  # Directory doesn't exist yet, will create safely
    fi

    local dir_owner
    dir_owner="$(stat -c "%u" "$dir" 2>/dev/null || echo "")"
    local current_uid
    current_uid="$(id -u)"

    # Safe if owned by current user or root
    if [ "$dir_owner" = "$current_uid" ] || [ "$dir_owner" = "0" ]; then
        return 0
    fi

    return 1
}

# Check if we're running in the docker directory of a Dify repo,
# or if we need to shallow clone the repository
setup_working_directory() {
    local script_dir
    script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

    # Check if we're already in a docker directory with required files
    if [ -f "${script_dir}/.env.example" ] && [ -f "${script_dir}/docker-compose.yaml" ]; then
        if ! is_safe_directory "$script_dir"; then
            print_error "Directory $script_dir is not owned by you or root. Aborting for security."
            exit 1
        fi
        cd "$script_dir"
        SCRIPT_DIR="$script_dir"
        return 0
    fi

    # Check if current directory has required files
    if [ -f ".env.example" ] && [ -f "docker-compose.yaml" ]; then
        local current_dir
        current_dir="$(pwd)"
        if ! is_safe_directory "$current_dir"; then
            print_error "Directory $current_dir is not owned by you or root. Aborting for security."
            exit 1
        fi
        SCRIPT_DIR="$current_dir"
        cd "$SCRIPT_DIR"
        return 0
    fi

    # Check if parent directory has a docker subdirectory with required files
    if [ -d "../docker" ] && [ -f "../docker/.env.example" ] && [ -f "../docker/docker-compose.yaml" ]; then
        local parent_dir
        parent_dir="$(cd .. && pwd)/docker"
        if ! is_safe_directory "$parent_dir"; then
            print_error "Directory $parent_dir is not owned by you or root. Aborting for security."
            exit 1
        fi
        cd "../docker"
        SCRIPT_DIR="$(pwd)"
        return 0
    fi

    # Need to clone the repository
    echo "Setting up Dify installation..."
    local install_dir="dify"
    local clone_dir="$install_dir"

    # Check if dify directory already exists with a docker subdirectory
    if [ -d "$clone_dir" ] && [ -d "$clone_dir/docker" ] && [ -f "$clone_dir/docker/.env.example" ] && [ -f "$clone_dir/docker/docker-compose.yaml" ]; then
        if ! is_safe_directory "$clone_dir"; then
            print_error "Directory $clone_dir is not owned by you or root. Aborting for security."
            exit 1
        fi
        cd "$clone_dir/docker"
        SCRIPT_DIR="$(pwd)"
        print_ok "Using existing Dify installation in $SCRIPT_DIR"
        return 0
    fi

    # Clone or pull the repository
    if [ -d "$clone_dir" ]; then
        if ! is_safe_directory "$clone_dir"; then
            print_error "Directory $clone_dir is not owned by you or root. Aborting for security."
            exit 1
        fi
        cd "$clone_dir"
        print_step "Updating Dify repository..."
        if git pull origin "$GITHUB_BRANCH" 2>/dev/null; then
            print_ok "Updated Dify repository"
        else
            print_warn "Could not update, using existing version"
        fi
        cd ..
    else
        print_header
        echo "Cloning Dify repository (shallow, this will be quick)..."
        echo ""
        print_step "Cloning from ${GITHUB_REPO} (branch: ${GITHUB_BRANCH})..."

        if ! command -v git &> /dev/null; then
            print_error "Git is not installed"
            echo "Please install Git first or clone the repository manually."
            exit 1
        fi

        # Verify parent directory is safe before cloning
        local parent_dir
        parent_dir="$(pwd)"
        if ! is_safe_directory "$parent_dir"; then
            print_error "Current directory is not owned by you or root. Aborting for security."
            exit 1
        fi

        if ! git clone --depth 1 --branch "$GITHUB_BRANCH" "https://github.com/${GITHUB_REPO}.git" "$clone_dir" 2>&1; then
            print_error "Failed to clone repository"
            echo "Please check your network connection and try again."
            exit 1
        fi
        print_ok "Cloned Dify repository"
    fi

    cd "$clone_dir/docker"
    SCRIPT_DIR="$(pwd)"
    echo ""
    print_ok "Dify files ready in $SCRIPT_DIR"
    echo ""
}

# Cleanup trap
TEMP_FILES=()
cleanup() {
    for f in "${TEMP_FILES[@]}"; do
        rm -f "$f" 2>/dev/null || true
    done
}
trap cleanup EXIT

# Run working directory setup before anything else
setup_working_directory

# ============================================
# Remaining function definitions
# ============================================

# Escape string for safe use in sed replacement
escape_sed() {
    printf '%s\n' "$1" | sed -e ':a' -e '$!N' -e '$!ba' -e 's/[\/&|#$\!`"]/\\&/g'
}

print_success() {
    echo ""
    echo -e "${GREEN}┌─────────────────────────────────────────────────────┐${NC}"
    echo -e "${GREEN}│  Installation Complete! 🎉                           │${NC}"
    echo -e "${GREEN}└─────────────────────────────────────────────────────┘${NC}"
    echo ""
    echo -e "${GREEN}✓ Dify is now starting!${NC}"
    echo ""

    local protocol="http"
    if [ "$NGINX_HTTPS_ENABLED" = true ]; then
        protocol="https"
    fi
    local access_url="${protocol}://${DOMAIN}"
    if [ "$protocol" = "http" ] && [ "$HTTP_PORT" != "80" ]; then
        access_url="${access_url}:${HTTP_PORT}"
    elif [ "$protocol" = "https" ] && [ "$HTTPS_PORT" != "443" ]; then
        access_url="${access_url}:${HTTPS_PORT}"
    fi

    echo "Next step:         Open ${access_url}/install in your browser"
    echo "                   to complete the initial setup."
    echo ""
    echo "Access Dify at:  ${access_url}"
    echo ""
    echo "Quick commands:"
    echo "  (Run these from: $SCRIPT_DIR)"
    echo "  View logs:       docker compose logs -f"
    echo "  Stop:            docker compose down"
    echo "  Start:           docker compose up -d"
    echo "  Status:          docker compose ps"
    echo ""
    echo "Configuration:"
    echo "  Working directory: $SCRIPT_DIR"
    echo "  .env file:         $SCRIPT_DIR/.env"
    if [ -n "${BACKUP_FILE:-}" ]; then
        echo "  Backup:            $BACKUP_FILE"
    fi
    echo ""
    if [ "$DEPLOY_TYPE" = "public" ] && [ "$NGINX_HTTPS_ENABLED" = true ] && [ "$NGINX_ENABLE_CERTBOT_CHALLENGE" = true ]; then
        echo "SSL Certificate:"
        echo "  To enable HTTPS with Certbot, make sure:"
        echo "  1. Your domain ${DOMAIN} points to this server"
        echo "  2. Ports 80 and 443 are open to the public"
        echo "  3. Run: docker compose --profile certbot up -d"
        echo ""
    fi
    echo "Need help?"
    echo "  Documentation:   https://docs.dify.ai"
    echo "  Issues:          https://github.com/langgenius/dify/issues"
    echo ""
    echo "Cloud hosting:"
    echo "  If self-hosting is too complex, try Dify Cloud:"
    echo "  https://cloud.dify.ai"
    echo ""
}

# Ask functions
ask() {
    local prompt="$1"
    local default="$2"
    local result
    read -p "$prompt [$default] " result
    echo "${result:-$default}"
}

ask_choice() {
    local prompt="$1"
    local default="$2"
    shift 2
    local options=("$@")

    echo "$prompt"
    for i in "${!options[@]}"; do
        echo "  [$((i+1))] ${options[$i]}"
    done

    local result
    read -p "Your choice: [$default] " result
    result="${result:-$default}"

    if ! [[ "$result" =~ ^[0-9]+$ ]] || [ "$result" -lt 1 ] || [ "$result" -gt "${#options[@]}" ]; then
        result="$default"
    fi

    echo "$result"
}

ask_yes_no() {
    local prompt="$1"
    local default="$2"
    local default_display="$([ "$default" = true ] && echo "Y/n" || echo "y/N")"

    local result
    read -p "$prompt [$default_display] " result
    result="${result:-$([ "$default" = true ] && echo "y" || echo "n")}"

    case "$result" in
        [Yy]*) echo "true" ;;
        *) echo "false" ;;
    esac
}

# Secret generation - secure random generation with proper fallbacks
generate_secret_key() {
    # Try openssl first (most common)
    if command -v openssl &> /dev/null; then
        openssl rand -base64 42
        return
    fi

    # Try Python with secrets module (secure)
    if command -v python3 &> /dev/null; then
        python3 -c "import secrets; import base64; print(base64.b64encode(secrets.token_bytes(32)).decode())"
        return
    fi

    # Try /dev/urandom (available on most Unix-like systems)
    if [ -c /dev/urandom ]; then
        # Use uuencode if available
        if command -v uuencode &> /dev/null; then
            head -c 48 /dev/urandom 2>/dev/null | uuencode -m - | tail -n +2 | tr -d '\n'
            return
        fi

        # Use base64 if available
        if command -v base64 &> /dev/null; then
            head -c 48 /dev/urandom 2>/dev/null | base64 | tr -d '\n'
            return
        fi
    fi

    # Last resort: if we get here, we can't generate secure secrets
    print_error "Cannot generate secure secrets: no secure random source found"
    echo "Please install openssl or Python 3.6+ and try again."
    exit 1
}

generate_password() {
    local length=${1:-16}

    # Try openssl first
    if command -v openssl &> /dev/null; then
        openssl rand -base64 "$((length * 2))" 2>/dev/null | tr -d '/+=' | cut -c1-"$length"
        return
    fi

    # Try Python with secrets module
    if command -v python3 &> /dev/null; then
        python3 -c "import secrets; import string; print(''.join(secrets.choice(string.ascii_letters + string.digits) for _ in range($length)))"
        return
    fi

    # Try /dev/urandom
    if [ -c /dev/urandom ]; then
        tr -dc 'a-zA-Z0-9' < /dev/urandom 2>/dev/null | head -c "$length"
        return
    fi

    # Last resort
    print_error "Cannot generate secure password: no secure random source found"
    echo "Please install openssl or Python 3.6+ and try again."
    exit 1
}

# Check if a port is in use
check_port() {
    local port=$1
    if command -v lsof &> /dev/null; then
        if lsof -i :"$port" &> /dev/null; then
            return 1
        fi
    elif command -v netstat &> /dev/null; then
        if netstat -tuln 2>/dev/null | grep -q ":$port " &> /dev/null; then
            return 1
        fi
    elif command -v ss &> /dev/null; then
        if ss -tuln 2>/dev/null | grep -q ":$port " &> /dev/null; then
            return 1
        fi
    fi
    return 0
}

# Prerequisite checks
check_docker() {
    if ! command -v docker &> /dev/null; then
        print_error "Docker is not installed"
        echo "Please install Docker first: https://docs.docker.com/get-docker/"
        exit 1
    fi
    local docker_version=$(docker --version | awk '{print $3}' | sed 's/,//')
    print_ok "Docker is installed (v$docker_version)"
}

check_docker_compose() {
    if ! docker compose version &> /dev/null; then
        print_error "Docker Compose is not installed"
        echo "Please install Docker Compose first"
        exit 1
    fi
    local compose_version=$(docker compose version | awk '{print $4}' | sed 's/,//')
    print_ok "Docker Compose is installed (v$compose_version)"
}

check_system_resources() {
    local cpu_cores
    if [[ "$(uname)" == "Darwin" ]]; then
        cpu_cores=$(sysctl -n hw.ncpu)
    else
        cpu_cores=$(nproc)
    fi

    if [ "$cpu_cores" -lt 2 ]; then
        print_warn "Only $cpu_cores CPU cores detected. Dify requires at least 2 cores."
        echo "    Consider using Dify Cloud for better performance: https://cloud.dify.ai"
    else
        print_ok "CPU: $cpu_cores cores (minimum 2 required)"
    fi

    local total_ram
    if [[ "$(uname)" == "Darwin" ]]; then
        total_ram=$(sysctl -n hw.memsize | awk '{print int($1/1024/1024/1024)}')
    else
        total_ram=$(free -g 2>/dev/null | awk '/Mem:/ {print $2}' || echo 0)
        if [ "$total_ram" -eq 0 ]; then
            total_ram=$(awk '/MemTotal/ {print int($2/1024/1024)}' /proc/meminfo 2>/dev/null || echo 4)
        fi
    fi

    if [ "$total_ram" -lt 4 ]; then
        print_warn "Only ${total_ram}GB RAM detected. Dify requires at least 4GB."
        echo "    Consider using Dify Cloud for better performance: https://cloud.dify.ai"
    else
        print_ok "RAM: ${total_ram}GB (minimum 4 required)"
    fi
}

check_ports() {
    if ! check_port "$HTTP_PORT"; then
        print_warn "Port $HTTP_PORT is already in use"
    fi
    if [ "$NGINX_HTTPS_ENABLED" = true ] && ! check_port "$HTTPS_PORT"; then
        print_warn "Port $HTTPS_PORT is already in use"
    fi
}

check_prerequisites() {
    echo "Checking prerequisites..."
    check_docker
    check_docker_compose
    check_system_resources
    echo ""
}

# Storage configuration
configure_s3() {
    echo ""
    echo "AWS S3 Configuration:"
    S3_BUCKET=$(ask "S3 Bucket name" "")
    S3_REGION=$(ask "S3 Region" "us-east-1")
    S3_ACCESS_KEY=$(ask "AWS Access Key ID" "")
    S3_SECRET_KEY=$(ask "AWS Secret Access Key" "")
}

configure_azure() {
    echo ""
    echo "Azure Blob Storage Configuration:"
    AZURE_ACCOUNT=$(ask "Azure Account name" "")
    AZURE_KEY=$(ask "Azure Account key" "")
    AZURE_CONTAINER=$(ask "Azure Container name" "")
}

configure_gcs() {
    echo ""
    echo "Google Cloud Storage Configuration:"
    GCS_BUCKET=$(ask "GCS Bucket name" "")
    GCS_PROJECT=$(ask "GCP Project ID" "")
    echo "Please place your service account key file in the current directory, named gcs-credentials.json"
}

configure_aliyun() {
    echo ""
    echo "Aliyun OSS Configuration:"
    ALIYUN_BUCKET=$(ask "OSS Bucket name" "")
    ALIYUN_REGION=$(ask "OSS Region" "oss-cn-hangzhou")
    ALIYUN_ACCESS_KEY=$(ask "Access Key ID" "")
    ALIYUN_SECRET_KEY=$(ask "Access Key Secret" "")
}

# Email configuration
configure_email() {
    echo ""
    echo "Email Service Configuration:"
    MAIL_PROVIDER=$(ask_choice "Email provider" "1" \
        "SMTP Server (generic)" \
        "Gmail" \
        "SendGrid" \
        "Resend")

    case $MAIL_PROVIDER in
        1)
            SMTP_HOST=$(ask "SMTP server" "")
            SMTP_PORT=$(ask "SMTP port" "587")
            SMTP_USER=$(ask "SMTP username" "")
            SMTP_PASSWORD=$(ask "SMTP password" "")
            SMTP_FROM=$(ask "From email" "$SMTP_USER")
            ;;
        2)
            SMTP_HOST="smtp.gmail.com"
            SMTP_PORT="587"
            SMTP_USER=$(ask "Gmail address" "")
            SMTP_PASSWORD=$(ask "Gmail app password" "")
            SMTP_FROM="$SMTP_USER"
            ;;
        3)
            SMTP_HOST="smtp.sendgrid.net"
            SMTP_PORT="587"
            SMTP_USER="apikey"
            SMTP_PASSWORD=$(ask "SendGrid API Key" "")
            SMTP_FROM=$(ask "From email" "")
            ;;
        4)
            SMTP_HOST="smtp.resend.com"
            SMTP_PORT="587"
            SMTP_USER="resend"
            SMTP_PASSWORD=$(ask "Resend API Key" "")
            SMTP_FROM=$(ask "From email" "")
            ;;
    esac
}

# Interactive configuration
interactive_config() {
    print_header
    echo "I'll ask you a few simple questions. Press Enter to accept defaults (recommended)."
    echo ""

    print_section "Deployment Type"

    DEPLOY_CHOICE=$(ask_choice "Deployment type" "1" \
        "Private / Local ⭐ Recommended (localhost/IP, no SSL)" \
        "Public / Production (with domain, optional SSL)")

    if [ "$DEPLOY_CHOICE" = "2" ]; then
        DEPLOY_TYPE="public"
        print_section "Domain and Network"

        DOMAIN=$(ask "Domain name (e.g., dify.example.com)" "")
        while [ -z "$DOMAIN" ]; do
            DOMAIN=$(ask "Domain name (required for public deployment)" "")
        done
        NGINX_SERVER_NAME="$DOMAIN"

        HTTP_PORT=$(ask "HTTP port" "80")
        HTTPS_PORT=$(ask "HTTPS port" "443")

        print_section "SSL Certificate"

        SSL_CHOICE=$(ask_choice "SSL Certificate option" "1" \
            "No SSL (use HTTP only) ⭐ Recommended for testing" \
            "Enable SSL (with Let's Encrypt / Certbot)" \
            "Enable SSL (custom certificates)")

        case $SSL_CHOICE in
            1)
                NGINX_HTTPS_ENABLED=false
                ;;
            2)
                NGINX_HTTPS_ENABLED=true
                NGINX_ENABLE_CERTBOT_CHALLENGE=true
                CERTBOT_EMAIL=$(ask "Email for Let's Encrypt notifications" "")
                ;;
            3)
                NGINX_HTTPS_ENABLED=true
                echo ""
                echo "Note: You'll need to place your SSL certificates in ./nginx/ssl/"
                echo "  - Certificate: ./nginx/ssl/dify.crt"
                echo "  - Private key: ./nginx/ssl/dify.key"
                ;;
        esac
    else
        DEPLOY_TYPE="private"
        print_section "Network Configuration"

        DOMAIN=$(ask "IP address or hostname" "localhost")
        HTTP_PORT=$(ask "HTTP port" "80")
        NGINX_SERVER_NAME="$DOMAIN"
        NGINX_HTTPS_ENABLED=false
    fi

    print_section "Database Selection"

    DB_CHOICE=$(ask_choice "Main database" "1" \
        "PostgreSQL ⭐ Recommended (best supported, most reliable)" \
        "MySQL")

    case $DB_CHOICE in
        1) DB_TYPE="postgresql" ;;
        2) DB_TYPE="mysql" ;;
    esac

    print_section "Vector Database Selection"

    VECTOR_CHOICE=$(ask_choice "Vector database" "1" \
        "Weaviate ⭐ Recommended (most tested with Dify)" \
        "Qdrant (lightweight, fast)" \
        "Milvus (enterprise-grade, powerful)" \
        "Chroma (simple, good for development)" \
        "pgvector (uses PostgreSQL, fewer services)")

    case $VECTOR_CHOICE in
        1) VECTOR_STORE="weaviate" ;;
        2) VECTOR_STORE="qdrant" ;;
        3) VECTOR_STORE="milvus" ;;
        4) VECTOR_STORE="chroma" ;;
        5) VECTOR_STORE="pgvector" ;;
    esac

    print_section "Storage Selection"

    STORAGE_CHOICE=$(ask_choice "File storage" "1" \
        "Local filesystem ⭐ Recommended (simplest)" \
        "AWS S3" \
        "Azure Blob Storage" \
        "Google Cloud Storage" \
        "Aliyun OSS")

    case $STORAGE_CHOICE in
        1) STORAGE_TYPE="opendal"; OPENDAL_SCHEME="fs" ;;
        2) STORAGE_TYPE="s3"; configure_s3 ;;
        3) STORAGE_TYPE="azure"; configure_azure ;;
        4) STORAGE_TYPE="gcs"; configure_gcs ;;
        5) STORAGE_TYPE="aliyun"; configure_aliyun ;;
    esac

    print_section "Email Service (Optional)"

    CONFIGURE_EMAIL=$(ask_yes_no "Configure email service? (for password resets, etc.)" false)

    if [ "$CONFIGURE_EMAIL" = true ]; then
        configure_email
    fi

    print_section "Confirmation"

    echo "Your configuration:"
    echo "  ✓ Deployment: $([ "$DEPLOY_TYPE" = "public" ] && echo "Public (with domain)" || echo "Private / Local")"
    echo "  ✓ Domain/IP: $DOMAIN"
    if [ "$DEPLOY_TYPE" = "public" ]; then
        echo "  ✓ SSL: $([ "$NGINX_HTTPS_ENABLED" = true ] && echo "Enabled" || echo "Disabled")"
    fi
    echo "  ✓ HTTP Port: $HTTP_PORT"
    if [ "$NGINX_HTTPS_ENABLED" = true ]; then
        echo "  ✓ HTTPS Port: $HTTPS_PORT"
    fi
    echo "  ✓ Database: $DB_TYPE"
    echo "  ✓ Vector DB: $VECTOR_STORE"
    echo "  ✓ Storage: $([ "$STORAGE_TYPE" = "opendal" ] && echo "Local filesystem" || echo "$STORAGE_TYPE")"
    echo "  ✓ Email: $([ "$CONFIGURE_EMAIL" = true ] && echo "Configured" || echo "Disabled")"
    echo ""
    echo "All secrets will be auto-generated, secure and unique."
    echo ""

    read -p "Press Enter to start installation, or Ctrl+C to cancel. "
    echo ""
}

# Generate secrets
generate_secrets() {
    echo "Generating secure secrets..."
    SECRET_KEY=$(generate_secret_key)
    DB_PASSWORD=$(generate_password)
    REDIS_PASSWORD=$(generate_password)
    SANDBOX_API_KEY=$(generate_secret_key)
    PLUGIN_DAEMON_KEY=$(generate_secret_key)
    PLUGIN_DIFY_INNER_API_KEY=$(generate_secret_key)
    print_ok "SECRET_KEY generated"
    print_ok "DB_PASSWORD generated"
    print_ok "REDIS_PASSWORD generated"
    print_ok "SANDBOX_API_KEY generated"
    print_ok "PLUGIN_DAEMON_KEY generated"
    print_ok "PLUGIN_DIFY_INNER_API_KEY generated"
    echo ""
}

# Update .env file with proper escaping
update_env() {
    local key="$1"
    local value="$2"
    local file="$3"
    sed -i.bak "s|^${key}=.*|${key}=$(escape_sed "$value")|" "$file"
    TEMP_FILES+=("$file.bak")
}

# Create .env file
create_env_file() {
    echo "Creating configuration..."

    if [ -f ".env" ]; then
        BACKUP_FILE=".env.backup-$(date +%Y%m%d-%H%M%S)"
        cp ".env" "$BACKUP_FILE"
        # Also set restrictive permissions on backup
        chmod 600 "$BACKUP_FILE" 2>/dev/null || true
        print_ok "Backed up existing .env to $BACKUP_FILE"
    fi

    if [ ! -f ".env.example" ]; then
        print_error ".env.example not found!"
        exit 1
    fi
    cp ".env.example" ".env"

    local protocol="http"
    if [ "$NGINX_HTTPS_ENABLED" = true ]; then
        protocol="https"
    fi
    local base_url="${protocol}://${DOMAIN}"
    if [ "$protocol" = "http" ] && [ "$HTTP_PORT" != "80" ]; then
        base_url="${base_url}:${HTTP_PORT}"
    elif [ "$protocol" = "https" ] && [ "$HTTPS_PORT" != "443" ]; then
        base_url="${base_url}:${HTTPS_PORT}"
    fi

    # Build FILES_URL correctly - use just the domain without external port
    local files_protocol="$protocol"
    local files_host="$DOMAIN"
    local files_url="${files_protocol}://${files_host}:5001"

    update_env "SECRET_KEY" "$SECRET_KEY" ".env"
    update_env "DB_PASSWORD" "$DB_PASSWORD" ".env"
    update_env "REDIS_PASSWORD" "$REDIS_PASSWORD" ".env"
    update_env "SANDBOX_API_KEY" "$SANDBOX_API_KEY" ".env"
    update_env "PLUGIN_DAEMON_KEY" "$PLUGIN_DAEMON_KEY" ".env"
    update_env "PLUGIN_DIFY_INNER_API_KEY" "$PLUGIN_DIFY_INNER_API_KEY" ".env"

    update_env "CONSOLE_API_URL" "$base_url" ".env"
    update_env "CONSOLE_WEB_URL" "$base_url" ".env"
    update_env "SERVICE_API_URL" "$base_url" ".env"
    update_env "APP_WEB_URL" "$base_url" ".env"
    update_env "FILES_URL" "$files_url" ".env"
    update_env "INTERNAL_FILES_URL" "http://api:5001" ".env"

    update_env "DB_TYPE" "$DB_TYPE" ".env"
    update_env "VECTOR_STORE" "$VECTOR_STORE" ".env"
    update_env "COMPOSE_PROFILES" "$VECTOR_STORE,$DB_TYPE" ".env"

    update_env "NGINX_SERVER_NAME" "$NGINX_SERVER_NAME" ".env"
    update_env "NGINX_HTTPS_ENABLED" "$NGINX_HTTPS_ENABLED" ".env"
    update_env "NGINX_PORT" "$HTTP_PORT" ".env"
    update_env "NGINX_SSL_PORT" "$HTTPS_PORT" ".env"
    update_env "EXPOSE_NGINX_PORT" "$HTTP_PORT" ".env"
    update_env "EXPOSE_NGINX_SSL_PORT" "$HTTPS_PORT" ".env"

    if [ "$NGINX_HTTPS_ENABLED" = true ] && [ -n "$CERTBOT_EMAIL" ]; then
        update_env "NGINX_ENABLE_CERTBOT_CHALLENGE" "true" ".env"
        update_env "CERTBOT_EMAIL" "$CERTBOT_EMAIL" ".env"
        update_env "CERTBOT_DOMAIN" "$DOMAIN" ".env"
    fi

    update_env "STORAGE_TYPE" "$STORAGE_TYPE" ".env"
    if [ "$STORAGE_TYPE" = "opendal" ]; then
        update_env "OPENDAL_SCHEME" "$OPENDAL_SCHEME" ".env"
    fi

    if [ "$STORAGE_TYPE" = "s3" ]; then
        update_env "S3_BUCKET_NAME" "$S3_BUCKET" ".env"
        update_env "S3_REGION" "$S3_REGION" ".env"
        update_env "S3_ACCESS_KEY" "$S3_ACCESS_KEY" ".env"
        update_env "S3_SECRET_KEY" "$S3_SECRET_KEY" ".env"
    elif [ "$STORAGE_TYPE" = "azure" ]; then
        update_env "AZURE_BLOB_ACCOUNT_NAME" "$AZURE_ACCOUNT" ".env"
        update_env "AZURE_BLOB_ACCOUNT_KEY" "$AZURE_KEY" ".env"
        update_env "AZURE_BLOB_CONTAINER_NAME" "$AZURE_CONTAINER" ".env"
    elif [ "$STORAGE_TYPE" = "aliyun" ]; then
        update_env "ALIYUN_OSS_BUCKET_NAME" "$ALIYUN_BUCKET" ".env"
        update_env "ALIYUN_OSS_REGION" "$ALIYUN_REGION" ".env"
        update_env "ALIYUN_OSS_ACCESS_KEY_ID" "$ALIYUN_ACCESS_KEY" ".env"
        update_env "ALIYUN_OSS_ACCESS_KEY_SECRET" "$ALIYUN_SECRET_KEY" ".env"
    fi

    if [ "$CONFIGURE_EMAIL" = true ]; then
        update_env "MAIL_TYPE" "smtp" ".env"
        update_env "SMTP_HOST" "$SMTP_HOST" ".env"
        update_env "SMTP_PORT" "$SMTP_PORT" ".env"
        update_env "SMTP_USER" "$SMTP_USER" ".env"
        update_env "SMTP_PASSWORD" "$SMTP_PASSWORD" ".env"
        update_env "MAIL_FROM_ADDRESS" "$SMTP_FROM" ".env"
    fi

    # Set restrictive permissions on .env file (only owner can read/write)
    chmod 600 ".env"
    print_ok "Created .env with your configuration"
    echo ""
}

# Check service health status
check_service_health() {
    local services=$(docker compose ps --format json 2>/dev/null)
    if [ -z "$services" ]; then
        return 1
    fi

    if command -v jq &> /dev/null; then
        # Check if any service is not healthy/running using jq
        if echo "$services" | jq -s 'map(select(.State != "running" and .State != "created")) | length == 0' >/dev/null 2>&1; then
            return 0
        fi
    else
        # Simple check without jq - count unhealthy services
        local unhealthy=$(docker compose ps 2>/dev/null | grep -v "NAME" | grep -v -E "Up\s+\(healthy\)|Up\s+\(starting\)|Up|running|created" | wc -l)
        if [ "$unhealthy" -eq 0 ]; then
            return 0
        fi
    fi
    return 1
}

# Start services with proper error handling and health checks
start_services() {
    echo "Starting Dify..."
    print_step "Pulling images (this may take a few minutes)"
    if ! docker compose pull; then
        print_error "Failed to pull images"
        echo "Check the error above and try again."
        echo ""
        echo "If self-hosting is too complex, try Dify Cloud:"
        echo "  https://cloud.dify.ai"
        exit 1
    fi
    print_ok "Pulling images"

    print_step "Starting containers"
    if ! docker compose up -d; then
        print_error "Failed to start containers"
        echo "Check the error above and try again."
        echo ""
        echo "If self-hosting is too complex, try Dify Cloud:"
        echo "  https://cloud.dify.ai"
        exit 1
    fi
    print_ok "Starting containers"

    print_step "Waiting for services to be healthy..."
    local max_wait=180
    local waited=0
    local healthy=false

    while [ $waited -lt $max_wait ]; do
        if check_service_health; then
            healthy=true
            break
        fi
        echo -n "."
        sleep 5
        waited=$((waited + 5))
    done
    echo ""

    if [ "$healthy" = true ]; then
        print_ok "Services are starting up"
    else
        print_warn "Services may still be starting. Check status with: docker compose ps"
        echo ""
        echo "If issues persist, consider Dify Cloud for a managed experience:"
        echo "  https://cloud.dify.ai"
    fi
    echo ""
}

# Main installation flow
main() {
    if [ "$INTERACTIVE" = true ]; then
        interactive_config
        check_prerequisites
        check_ports
    else
        print_header
        check_prerequisites
        check_ports
        echo "Using all recommended defaults (no interactive mode)"
        echo ""
        if [ "$YES_MODE" = false ]; then
            read -p "Continue with installation? [y/N] " -n 1 -r
            echo
            if [[ ! $REPLY =~ ^[Yy]$ ]]; then
                echo "Installation cancelled."
                exit 0
            fi
            echo ""
        fi
    fi

    generate_secrets
    create_env_file
    start_services
    print_success
}

# ============================================
# End of function definitions
# ============================================

# Parse command line arguments (after all functions are defined)
while [[ $# -gt 0 ]]; do
    case "$1" in
        --interactive|-i) INTERACTIVE=true; YES_MODE=false; shift ;;
        --yes|-y|--default) YES_MODE=true; INTERACTIVE=false; shift ;;
        --help|-h) show_help; exit 0 ;;
        *) echo "Unknown option: $1"; show_help; exit 1 ;;
    esac
done

# Run installation
main
