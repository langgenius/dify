#!/bin/bash

if [ "${VECTOR_STORE}" = "elasticsearch-ja" ]; then
    # Check if the icu tokenizer plugin is installed
    if ! /usr/share/elasticsearch/bin/elasticsearch-plugin list | grep -q analysis-icu; then
        printf '%s\n' "Installing the ICU tokenizer plugin"
        /usr/share/elasticsearch/bin/elasticsearch-plugin install analysis-icu
    fi
    # Check if the Japanese language analyzer plugin is installed
    if ! /usr/share/elasticsearch/bin/elasticsearch-plugin list | grep -q analysis-kuromoji; then
        printf '%s\n' "Installing the Japanese language analyzer plugin"
        /usr/share/elasticsearch/bin/elasticsearch-plugin install analysis-kuromoji
    fi
fi

# Run the original entrypoint script
/bin/tini -- /usr/local/bin/docker-entrypoint.sh
