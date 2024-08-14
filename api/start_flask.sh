#!/bin/bash

# Activate the poetry environment
source $(poetry env info --path)/bin/activate

# Navigate to the project directory
cd /home/ganeshji/difyown/api

# Start the Flask server
flask run --host 0.0.0.0 --port=5001 --debug
