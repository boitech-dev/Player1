# Debian (glibc), not Alpine: the Node runtimes run.mjs downloads and the Android build tools are glibc binaries
FROM node:26-trixie-slim
# ffprobe reads the tracks of library files (nothing here converts video); git fetches updates; xz unpacks Node runtimes
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg git ca-certificates xz-utils && rm -rf /var/lib/apt/lists/*
CMD ["node", "run.mjs"]
