#!/usr/bin/env bash
# Encode one clip for the page: a web-ready MP4 and a JPEG poster next to it.
#
#   scripts/media.sh SRC DEST [WIDTH] [POSTER_AT]
#
#   SRC        any video ffmpeg reads
#   DEST       output path without extension, relative to public/media
#              (e.g. rollouts/drawer_top_open/s1_seed620001)
#   WIDTH      output width in px, height follows the aspect ratio (default 1280)
#   POSTER_AT  timestamp for the poster frame: seconds, or "end" for the last
#              frame (default 0.5)
#
# Writes public/media/DEST.mp4 and public/media/DEST.jpg. H.264, no audio,
# faststart so playback begins before the download finishes.
set -euo pipefail
src=$1; dest=$2; width=${3:-1280}; poster_at=${4:-0.5}
root=$(cd "$(dirname "$0")/.." && pwd)
out="$root/public/media/$dest"
mkdir -p "$(dirname "$out")"
ffmpeg -v error -y -i "$src" -an -vf "scale=${width}:-2:flags=lanczos" \
  -c:v libx264 -crf 23 -preset slow -pix_fmt yuv420p -movflags +faststart "$out.mp4"
if [ "$poster_at" = end ]; then seek=(-sseof -0.1); else seek=(-ss "$poster_at"); fi
ffmpeg -v error -y "${seek[@]}" -i "$out.mp4" -frames:v 1 -q:v 3 "$out.jpg"
printf '%s  %s\n' "$(du -h "$out.mp4" | cut -f1)" "public/media/$dest.mp4"
