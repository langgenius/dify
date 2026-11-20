---
name: chrome-devtools-cli
description: Use this skill to write shell scripts or run shell commands to automate tasks in the browser or otherwise use Chrome DevTools via CLI.
---

The `chrome-devtools-mcp` CLI lets you interact with the browser from your terminal.

## Setup

_Note: If this is your very first time using the CLI, see [references/installation.md](references/installation.md) for setup. Installation is a one-time prerequisite and is **not** part of the regular AI workflow._

## AI Workflow

1. **Execute**: Run tools directly. If you don't know the target page's ID, run `chrome-devtools list_pages` to find it. The background server starts implicitly; **do not** run `start`/`status`/`stop` before each use.
2. **Inspect**: Use `chrome-devtools take_snapshot <pageId>` to get an element `<uid>`.
3. **Act**: Use `chrome-devtools click <pageId> <uid>`, `chrome-devtools fill <pageId> <uid> <value>`, etc. State persists across commands.

Snapshot example:

```
uid=1_0 RootWebArea "Example Domain" url="https://example.com/"
  uid=1_1 heading "Example Domain" level="1"
```

## Permissions & File Access

By default, the CLI has full filesystem access (`--allowUnrestrictedPaths=true`), allowing file-saving parameters (`--filePath`, `--outputDirPath`) and `upload_file` to access files anywhere on the system. Pass `--allowUnrestrictedPaths=false` if you want to restrict file access to the OS temp directory.

## Command Usage

```sh
chrome-devtools <tool> [arguments] [flags]
```

- Required arguments are passed positionally; optional arguments use flags.
- Use `--help` on any command for usage details.
- Output defaults to plain Markdown-like text; pass `--output-format=json` for JSON.

## Input Automation (<uid> from snapshot)

```bash
chrome-devtools take_snapshot 1 # Take a text snapshot of the page to get UIDs for elements
chrome-devtools click 1 "id" # Clicks on the provided element
chrome-devtools click 1 "id" --dblClick true --includeSnapshot true # Double clicks and returns a snapshot
chrome-devtools drag 1 "src" "dst" # Drag an element onto another element
chrome-devtools drag 1 "src" "dst" --includeSnapshot true # Drag an element and return a snapshot
chrome-devtools fill 1 "id" "text" # Type text into an input, textarea, or select an option
chrome-devtools fill 1 "id" "text" --includeSnapshot true # Fill an element and return a snapshot
chrome-devtools handle_dialog 1 accept # Handle a browser dialog (accept/dismiss)
chrome-devtools handle_dialog 1 dismiss --promptText "hi" # Dismiss a dialog with prompt text
chrome-devtools hover 1 "id" # Hover over the provided element
chrome-devtools hover 1 "id" --includeSnapshot true # Hover over an element and return a snapshot
chrome-devtools press_key 1 "Enter" # Press a key or key combination ("Control+A", "Escape")
chrome-devtools press_key 1 "Control+A" --includeSnapshot true # Press a key and return a snapshot
chrome-devtools type_text 1 "hello" # Type text using keyboard into a focused input
chrome-devtools type_text 1 "hello" --submitKey "Enter" # Type text and press a submit key
chrome-devtools upload_file 1 "id" "file.txt" # Upload a file through a provided element
chrome-devtools upload_file 1 "id" "file.txt" --includeSnapshot true # Upload a file and return a snapshot
```

## Navigation

```bash
chrome-devtools close_page 1 # Closes the page by its index
chrome-devtools list_pages # Get a list of pages open in the browser
chrome-devtools navigate_page 1 --url "https://example.com" # Navigates the currently selected page to a URL
chrome-devtools navigate_page 1 --type "reload" --ignoreCache true # Reload page ignoring cache
chrome-devtools navigate_page 1 --url "https://example.com" --timeout 5000 # Navigate with a timeout
chrome-devtools navigate_page 1 --type "reload" --handleBeforeUnload "accept" # Handle before unload dialog
chrome-devtools navigate_page 1 --type "back" --initScript "foo()" # Navigate back and run an init script
chrome-devtools new_page "https://example.com" # Creates a new page
chrome-devtools new_page "https://example.com" --background true --timeout 5000 # Create new page in background
chrome-devtools new_page "https://example.com" --isolatedContext "ctx" # Create new page with isolated context
chrome-devtools select_page 1 # Select a page as a context for future tool calls
chrome-devtools select_page 1 --bringToFront true # Select a page and bring it to front
```

## Emulation

Each `emulate` call replaces all previously configured emulation settings (except `--extraHttpHeaders`), so pass all desired settings in a single call.

```bash
chrome-devtools emulate 1 --networkConditions "Offline" # Emulate network conditions (resets other settings)
chrome-devtools emulate 1 --cpuThrottlingRate 4 --geolocation "0,0" # Emulate CPU throttling and geolocation (resets other settings)
chrome-devtools emulate 1 --colorScheme "dark" --viewport "1920x1080" # Emulate color scheme and viewport (resets other settings)
chrome-devtools emulate 1 --userAgent "Mozilla/5.0..." # Emulate user agent (resets other settings)
chrome-devtools resize_page 1 1920 1080 # Resizes the selected page's window
```

## Performance

```bash
chrome-devtools performance_analyze_insight 1 "NAVIGATION_0" "LCPBreakdown" # Get more details on a specific Performance Insight (pageId, insightSetId, insightName)
chrome-devtools performance_start_trace 1 --reload true --autoStop false # Starts a performance trace recording (reload, autoStop)
chrome-devtools performance_start_trace 1 --reload true --autoStop true --filePath "t.json.gz" # Start trace and save to a file
chrome-devtools performance_stop_trace 1 # Stops the active performance trace
chrome-devtools performance_stop_trace 1 --filePath "t.json.gz" # Stop trace and save to a file
```

## Memory

```bash
chrome-devtools take_heapsnapshot 1 "./snap.heapsnapshot" # Capture a memory heap snapshot
```

### Memory Debugging (requires `--memoryDebugging=true`)

```bash
chrome-devtools get_heapsnapshot_summary "./snap.heapsnapshot" # Get snapshot summary stats
chrome-devtools compare_heapsnapshots "./base.heapsnapshot" "./target.heapsnapshot" # Compare two snapshots
chrome-devtools get_heapsnapshot_details "./snap.heapsnapshot" # Snapshot statistics and per-class aggregates (with class IDs)
chrome-devtools get_heapsnapshot_class_nodes "./snap.heapsnapshot" 18 # Inspect instances of a class (class ID from get_heapsnapshot_details)
chrome-devtools get_heapsnapshot_dominators "./snap.heapsnapshot" 123 # Dominator tree for node
chrome-devtools get_heapsnapshot_duplicate_strings "./snap.heapsnapshot" # Find duplicated strings
chrome-devtools get_heapsnapshot_edges "./snap.heapsnapshot" 123 # Node edges/references
chrome-devtools get_heapsnapshot_object_details "./snap.heapsnapshot" 123 # Object details by node ID
chrome-devtools get_heapsnapshot_retainers "./snap.heapsnapshot" 123 # Retaining objects
chrome-devtools get_heapsnapshot_retaining_paths "./snap.heapsnapshot" 123 # Shortest retaining paths
chrome-devtools close_heapsnapshot "./snap.heapsnapshot" # Free memory from loaded snapshot
```

## Network

Network mocking commands require `--categoryNetworkMocks=true` at server startup.
Changing this flag requires a server restart.

```bash
chrome-devtools get_network_request 1 # Get the currently selected network request for page 1
chrome-devtools get_network_request 1 --reqid 1 --requestFilePath "req.md" # Get request by id and save to file
chrome-devtools get_network_request 1 --reqid 1 --responseFilePath "res.md" # Save response body to file
chrome-devtools list_network_requests 1 # List all network requests for page 1
chrome-devtools list_network_requests 1 --pageSize 50 --pageIdx 0 # List network requests with pagination
chrome-devtools list_network_requests 1 --resourceTypes fetch # Filter requests by resource type
chrome-devtools list_network_requests 1 --includePreservedRequests true # Include preserved requests
chrome-devtools mock_network 1 --route 'https://example.com/app.js*' \
  --body /tmp/app.js # Replace a response with a local file
chrome-devtools mock_network 1 --route 'https://example.com/app.js*' \
  --upstream https://example.com/dev.js # Use an upstream URL instead
chrome-devtools mock_network 1 # Inspect all mocks
chrome-devtools mock_network 1 --resourceType script # Inspect script mocks
chrome-devtools remove_network_mock 1 --route 'https://example.com/app.js*'
chrome-devtools remove_network_mock 1 # Clear all mocks for page 1
```

## Debugging & Inspection

```bash
chrome-devtools evaluate_script "() => document.title" --pageId 1 # Evaluate a JavaScript function on page 1
chrome-devtools evaluate_script "(a) => a.innerText" --pageId 1 --args 1_4 # Evaluate JS with UID arguments on page 1
chrome-devtools evaluate_script --pageId 1 --sourcePath /path/to/script.js --format script # Evaluate a local classic JavaScript file on page 1
chrome-devtools get_console_message 1 1 # Gets a console message by its ID
chrome-devtools get_css_styles 1 "1_4" # Get CSS styles with pagination on page 1 (default: 10 rules, pageIdx 0)
chrome-devtools get_css_styles 1 "1_4" --pageSize 20 --pageIdx 1 # Paginate CSS rules with custom page size and custom 0-based page index
chrome-devtools lighthouse_audit 1 --mode "navigation" # Run Lighthouse audit for navigation
chrome-devtools lighthouse_audit 1 --mode "snapshot" --device "mobile" # Run Lighthouse audit for a snapshot on mobile
chrome-devtools lighthouse_audit 1 --outputDirPath ./out # Run Lighthouse audit and save reports
chrome-devtools list_console_messages 1 # List all console messages
chrome-devtools list_console_messages 1 --pageSize 20 --pageIdx 1 # List console messages with pagination
chrome-devtools list_console_messages 1 --types error --types info # Filter console messages by type
chrome-devtools list_console_messages 1 --includePreservedMessages true # Include preserved messages
chrome-devtools take_screenshot 1 # Take a screenshot of the page viewport
chrome-devtools take_screenshot 1 --fullPage true --format "jpeg" --quality 80 # Take a full page screenshot as JPEG with quality
chrome-devtools take_screenshot 1 --uid "id" --filePath "s.png" # Take a screenshot of an element
chrome-devtools take_snapshot 1 # Take a text snapshot of the page from the a11y tree
chrome-devtools take_snapshot 1 --verbose true --filePath "s.txt" # Take a verbose snapshot and save to file
chrome-devtools screencast_start 1 --filePath "screen.mp4" # Starts an mp4 screencast recording on page 1
chrome-devtools screencast_stop 1 # Stops the active screencast on page 1
```

## Extensions

```bash
chrome-devtools list_extensions # Lists the unpacked Chrome extensions loaded in the browser
chrome-devtools install_extension "/path/to/extension" # Installs a Chrome extension from the given path
chrome-devtools uninstall_extension "extension_id" # Uninstalls a Chrome extension by its ID
chrome-devtools reload_extension "extension_id" # Reloads an unpacked Chrome extension by its ID
chrome-devtools trigger_extension_action "extension_id" # Triggers the default action of an extension by its ID
```

## Progressive Web Apps (requires `--categoryPwa=true`)

```bash
chrome-devtools install_pwa "https://example.com/" "https://example.com/" # Install PWA by manifest ID and install URL
chrome-devtools launch_pwa "https://example.com/" # Launch installed PWA
chrome-devtools get_os_app_state "https://example.com/" # Get OS app installation state
chrome-devtools uninstall_pwa "https://example.com/" # Uninstall PWA and close windows
```

## Experimental Features

Experimental tools are disabled by default. Enable them with the corresponding flag during `start`.

```bash
chrome-devtools click_at 1 100 200 # Clicks at the provided coordinates on page 1 (requires --experimentalVision=true)
chrome-devtools list_webmcp_tools 1 # List all WebMCP tools on page 1 (requires --categoryExperimentalWebmcp=true)
chrome-devtools execute_webmcp_tool 1 "tool_name" --input '{"arg":"val"}' # Execute a WebMCP tool on page 1 (requires --categoryExperimentalWebmcp=true)
chrome-devtools list_3p_developer_tools 1 # List third-party developer tools on page 1 (requires --categoryExperimentalThirdParty=true)
chrome-devtools execute_3p_developer_tool 1 "tool_name" --params '{"arg":"val"}' # Execute third-party developer tool on page 1 (requires --categoryExperimentalThirdParty=true)
```

## Service Management

```bash
chrome-devtools start   # Start or restart chrome-devtools-mcp
chrome-devtools start --headless=false # Start with visible browser window
chrome-devtools status  # Checks if chrome-devtools-mcp is running
chrome-devtools stop    # Stop chrome-devtools-mcp if any
```
