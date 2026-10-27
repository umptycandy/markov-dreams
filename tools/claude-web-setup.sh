#!/bin/bash
# Claude Code on the web: environment setup script for the Markov Dreams fork
set -e
python3 -m pip install --quiet Pillow || python3 -m pip install --quiet --break-system-packages Pillow
if [ ! -d /opt/wasi-sdk ]; then
  curl -sSL https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-27/wasi-sdk-27.0-x86_64-linux.tar.gz | tar xz -C /opt
  mv /opt/wasi-sdk-27.0-x86_64-linux /opt/wasi-sdk
fi
echo 'export WASI_SDK=/opt/wasi-sdk' >> ~/.bashrc
