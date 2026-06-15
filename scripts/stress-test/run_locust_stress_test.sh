#!/bin/bash

# Run Dify SSE Stress Test using Locust

set -e

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
# Go to project root first, then to script dir
PROJECT_ROOT="$( cd "${SCRIPT_DIR}/../.." && pwd )"
cd "${PROJECT_ROOT}"
STRESS_TEST_DIR="scripts/stress-test"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Configuration
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
REPORT_DIR="${STRESS_TEST_DIR}/reports"
CSV_PREFIX="${REPORT_DIR}/locust_${TIMESTAMP}"
HTML_REPORT="${REPORT_DIR}/locust_report_${TIMESTAMP}.html"
SUMMARY_REPORT="${REPORT_DIR}/locust_summary_${TIMESTAMP}.txt"

# Create reports directory if it doesn't exist
mkdir -p "${REPORT_DIR}"

echo -e "${BLUE}╔════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║             DIFY SSE WORKFLOW STRESS TEST (LOCUST)             ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════════╝${NC}"
echo

# Check if services are running
echo -e "${YELLOW}Checking services...${NC}"

# Check Dify API
if curl -s -f http://localhost:5001/health > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Dify API is running${NC}"
    
    # Warn if running in debug mode (check for werkzeug in process)
    if ps aux | grep -v grep | grep -q "werkzeug.*5001\|flask.*run.*5001"; then
        echo -e "${YELLOW}⚠ WARNING: API appears to be running in debug mode (Flask development server)${NC}"
        echo -e "${YELLOW}  This will give inaccurate benchmark results!${NC}"
        echo -e "${YELLOW}  For accurate benchmarking, restart with Gunicorn:${NC}"
        echo -e "${CYAN}  cd api && uv run gunicorn --bind 0.0.0.0:5001 --workers 4 --worker-class gevent app:app${NC}"
        echo
        echo -n "Continue anyway? (not recommended) [y/N]: "
        read -t 10 continue_debug || continue_debug="n"
        if [ "$continue_debug" != "y" ] && [ "$continue_debug" != "Y" ]; then
            echo -e "${RED}Benchmark cancelled. Please restart API with Gunicorn.${NC}"
            exit 1
        fi
    fi
else
    echo -e "${RED}✗ Dify API is not running on port 5001${NC}"
    echo -e "${YELLOW}  Start it with Gunicorn for accurate benchmarking:${NC}"
    echo -e "${CYAN}  cd api && uv run gunicorn --bind 0.0.0.0:5001 --workers 4 --worker-class gevent app:app${NC}"
    exit 1
fi

# Check Mock OpenAI server
if curl -s -f http://localhost:5004/v1/models > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Mock OpenAI server is running${NC}"
else
    echo -e "${RED}✗ Mock OpenAI server is not running on port 5004${NC}"
    echo -e "${YELLOW}  Start it with: python scripts/stress-test/setup/mock_openai_server.py${NC}"
    exit 1
fi

# Check API token exists
if [ ! -f "${STRESS_TEST_DIR}/setup/config/stress_test_state.json" ]; then
    echo -e "${RED}✗ Stress test configuration not found${NC}"
    echo -e "${YELLOW}  Run setup first: python scripts/stress-test/setup_all.py${NC}"
    exit 1
fi

API_TOKEN=$(python3 -c "import json; state = json.load(open('${STRESS_TEST_DIR}/setup/config/stress_test_state.json')); print(state.get('api_key', {}).get('token', ''))" 2>/dev/null)
if [ -z "$API_TOKEN" ]; then
    echo -e "${RED}✗ Failed to read API token from stress test state${NC}"
    exit 1
fi
echo -e "${GREEN}✓ API token found: ${API_TOKEN:0:10}...${NC}"

echo
echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}                   STRESS TEST PARAMETERS                       ${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"

# Parse configuration
USERS=$(grep "^users" ${STRESS_TEST_DIR}/locust.conf | cut -d'=' -f2 | tr -d ' ')
SPAWN_RATE=$(grep "^spawn-rate" ${STRESS_TEST_DIR}/locust.conf | cut -d'=' -f2 | tr -d ' ')
RUN_TIME=$(grep "^run-time" ${STRESS_TEST_DIR}/locust.conf | cut -d'=' -f2 | tr -d ' ')

echo -e "  ${YELLOW}Users:${NC}       $USERS concurrent users"
echo -e "  ${YELLOW}Spawn Rate:${NC}  $SPAWN_RATE users/second"
echo -e "  ${YELLOW}Duration:${NC}    $RUN_TIME"
echo -e "  ${YELLOW}Mode:${NC}        SSE Streaming"
echo

# Ask user for run mode
echo -e "${YELLOW}Select run mode:${NC}"
echo "  1) Headless (CLI only) - Default"
echo "  2) Web UI (http://localhost:8089)"
echo -n "Choice [1]: "
read -t 10 choice || choice="1"
echo

# Use SSE stress test script
LOCUST_SCRIPT="${STRESS_TEST_DIR}/sse_benchmark.py"

# Prepare Locust command
if [ "$choice" = "2" ]; then
    echo -e "${BLUE}Starting Locust with Web UI...${NC}"
    echo -e "${YELLOW}Access the web interface at: ${CYAN}http://localhost:8089${NC}"
    echo
    
    # Run with web UI
    uv --project api run locust \
        -f ${LOCUST_SCRIPT} \
        --host http://localhost:5001 \
        --web-port 8089
else
    echo -e "${BLUE}Starting stress test in headless mode...${NC}"
    echo
    
    # Run in headless mode with CSV output
    uv --project api run locust \
        -f ${LOCUST_SCRIPT} \
        --host http://localhost:5001 \
        --users $USERS \
        --spawn-rate $SPAWN_RATE \
        --run-time $RUN_TIME \
        --headless \
        --print-stats \
        --csv=$CSV_PREFIX \
        --html=$HTML_REPORT \
        2>&1 | tee $SUMMARY_REPORT
    
    echo
    echo -e "${GREEN}═══════════════════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}                   STRESS TEST COMPLETE                        ${NC}"
    echo -e "${GREEN}═══════════════════════════════════════════════════════════════${NC}"
    echo
    echo -e "${BLUE}Reports generated:${NC}"
    echo -e "  ${YELLOW}Summary:${NC}     $SUMMARY_REPORT"
    echo -e "  ${YELLOW}HTML Report:${NC} $HTML_REPORT"
    echo -e "  ${YELLOW}CSV Stats:${NC}   ${CSV_PREFIX}_stats.csv"
    echo -e "  ${YELLOW}CSV History:${NC} ${CSV_PREFIX}_stats_history.csv"
    echo
    echo -e "${CYAN}View HTML report:${NC}"
    echo "  open $HTML_REPORT  # macOS"
    echo "  xdg-open $HTML_REPORT  # Linux"
    echo
    
    # Parse and display key metrics
    echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
    echo -e "${CYAN}                        KEY METRICS                            ${NC}"
    echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
    
    if [ -f "${CSV_PREFIX}_stats.csv" ]; then
        python3 - <<EOF
import csv
import sys

csv_file = "${CSV_PREFIX}_stats.csv"

try:
    with open(csv_file, 'r') as f:
        reader = csv.DictReader(f)
        rows = list(reader)
        
        # Find the aggregated row
        for row in rows:
            if row.get('Name') == 'Aggregated':
                print(f"  Total Requests:     {row.get('Request Count', 'N/A')}")
                print(f"  Failure Rate:       {row.get('Failure Count', '0')} failures")
                print(f"  Median Response:    {row.get('Median Response Time', 'N/A')} ms")
                print(f"  95%ile Response:    {row.get('95%', 'N/A')} ms")
                print(f"  99%ile Response:    {row.get('99%', 'N/A')} ms")
                print(f"  RPS:                {row.get('Requests/s', 'N/A')}")
                break
                
        # Show SSE-specific metrics
        print()
        print("SSE Streaming Metrics:")
        for row in rows:
            if 'Time to First Event' in row.get('Name', ''):
                print(f"  Time to First Event: {row.get('Median Response Time', 'N/A')} ms (median)")
            elif 'Stream Duration' in row.get('Name', ''):
                print(f"  Stream Duration:     {row.get('Median Response Time', 'N/A')} ms (median)")
                
except Exception as e:
    print(f"Could not parse metrics: {e}")
EOF
    fi
    
    echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
fi