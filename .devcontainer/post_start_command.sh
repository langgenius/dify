#!/bin/bash

source ~/.bashrc
sudo chmod 1777 /tmp
cd api && uv sync
