#!/usr/bin/env bash
# Optional: downloads the ORIGINAL Unsplash stock photos that the site used to
# hot-link, saving them as local files with the same names the HTML now expects.
#
# This build already ships with local SVG illustrations (branded in DURABON's
# gold/charcoal colors) so the site works fully offline with no external
# image requests. Run this script only if you'd rather use real photography
# instead of the illustrations. It needs internet access from wherever you
# run it (this cannot be run from inside the sandbox that built this zip).
#
# Usage:
#   cd frontend/asset/images
#   bash download-original-photos.sh
#
# After it finishes, open index.html / about.html and change the extension
# in each <img>/<source> src from ".svg" to ".jpg" for the photos you replaced.

set -e
declare -A PHOTOS=(
  ["gallery-classroom.jpg"]="https://images.unsplash.com/photo-1509062522246-3755977927d7?auto=format&fit=crop&w=900&q=80"
  ["gallery-1503676260728.jpg"]="https://images.unsplash.com/photo-1503676260728-1c00da094a0b?auto=format&fit=crop&w=900&q=80"
  ["gallery-1529390079861.jpg"]="https://images.unsplash.com/photo-1529390079861-591de354faf5?auto=format&fit=crop&w=900&q=80"
  ["gallery-library.jpg"]="https://images.unsplash.com/photo-1577896851231-70ef18881754?auto=format&fit=crop&w=900&q=80"
  ["gallery-graduation.jpg"]="https://images.unsplash.com/photo-1544717305-2782549b5136?auto=format&fit=crop&w=900&q=80"
  ["gallery-campus.jpg"]="https://images.unsplash.com/photo-1588072432836-e10032774350?auto=format&fit=crop&w=1000&q=80"
  ["gallery-1503676382389.jpg"]="https://images.unsplash.com/photo-1503676382389-4809596d5290?auto=format&fit=crop&w=900&q=80"
  ["about-approach.jpg"]="https://images.unsplash.com/photo-1524178232363-1fb2b075b655?auto=format&fit=crop&w=1200&q=80"
)

for name in "${!PHOTOS[@]}"; do
  echo "Downloading $name..."
  curl -sL "${PHOTOS[$name]}" -o "$name"
done
echo "Done. Files saved into $(pwd)."
