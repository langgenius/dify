#!/bin/bash
set -x

sudo sysctl -w vm.max_map_count=262144
