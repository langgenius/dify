#!/bin/bash
# To convert volume mappings in docker-compose.yaml to Podman's format with permission flags
# Usage: bash to_podman.sh

# Copy docker-compose.yaml to podman-compose.yaml
cp -f docker-compose.yaml podman-compose.yaml

# Add subfix to the volume mappings in podman-compose.yaml
# The :z flag for Podman is used to share the volume with all containers
sed -i '
# Search for volumes: and lines that do not start with a space
/volumes:/,/^[^ ]/ {
    # Skip lines that do not start with a space
    /volumes:\|:z[[:space:]]*\($\|#\)/ b
    
    # Skip lines that do not have a colon
    /[[:space:]]*-[[:space:]]*\([\.\/][^:]*:[^:#]*\)[[:space:]]*\(#.*\)*$/ {
        # Do not process lines that already have :z
        s/\([[:space:]]*-[[:space:]]*[^:]*:[^[:space:]]*\).*$/\1/
        # Append :z to the end of the line
        s/\([[:space:]]*-[[:space:]]*[^:]*:[^[:space:]]*\)\([[:space:]]*\(#.*\)\?$\)/\1:z\2/
    }
}' podman-compose.yaml

echo "Volume mappings have been updated for Podman in podman-compose.yaml"
echo "Run 'podman-compose -f podman-compose.yaml up -d' to start the containers"
