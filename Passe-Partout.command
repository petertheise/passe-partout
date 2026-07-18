#!/bin/bash
# Double-click to run Passe-Partout locally.
cd "$(dirname "$0")"
PORT=8791
echo "🧭  Passe-Partout — starting on http://localhost:$PORT"
# open the browser a moment after the server starts
( sleep 1; open "http://localhost:$PORT/index.html" ) &
python3 -m http.server $PORT
