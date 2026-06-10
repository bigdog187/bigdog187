#!/usr/bin/env python3
"""Build a single self-contained demo HTML from the web assets.

Inlines styles.css, the dashboard markup, the in-browser simulator engine
(web/demo-engine.js) and the dashboard JS into one file that runs with no
server, no Python and no network — just open it in a browser.

Usage:  python scripts/build_demo.py   ->  demo/earlyrise-mes-demo.html
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
css = (ROOT / "web/styles.css").read_text()
html = (ROOT / "web/index.html").read_text()
sim = (ROOT / "web/demo-engine.js").read_text()
js = (ROOT / "web/dashboard.js").read_text()

body = re.search(r"<body>(.*)</body>", html, re.S).group(1)
body = body.replace('<script src="/dashboard.js"></script>', "")

out = f"""<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Earlyrise Bakery — Production Reporting (Demo)</title>
<meta name="description" content="Earlyrise Bakery MES — standalone interactive demo (runs entirely in your browser).">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&family=JetBrains+Mono:wght@300;400;500;700&family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet">
<style>
{css}
</style>
</head>
<body>
{body}
<script>
/* ---- in-browser simulator + mock API (no server needed) ---- */
{sim}
/* ---- dashboard rendering (same code as the live app) ---- */
{js}
</script>
</body>
</html>
"""
dest = ROOT / "demo" / "earlyrise-mes-demo.html"
dest.write_text(out)
print(f"built {dest} ({len(out)} bytes)")
