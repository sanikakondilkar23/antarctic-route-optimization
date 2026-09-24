#!/usr/bin/env python3
import os, json

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONTEND_DIR = os.path.join(ROOT, "..", "frontend")
OUT = os.path.join(FRONTEND_DIR, "index.html")
TEMPLATE = os.path.join(ROOT, "scripts", "template.html")

with open(os.path.join(FRONTEND_DIR, "data", "values", "date_index.json")) as f:
    dates_js = json.dumps(json.load(f))
with open(os.path.join(FRONTEND_DIR, "data", "stations.json")) as f:
    stations_js = json.dumps(json.load(f))
with open(os.path.join(FRONTEND_DIR, "data", "coastline.json")) as f:
    coast_js = json.dumps(json.load(f))
with open(os.path.join(FRONTEND_DIR, "data", "horizon_metrics.json")) as f:
    hz_js = json.dumps(json.load(f))

with open(TEMPLATE, "r", encoding="utf-8") as f:
    tpl = f.read()

html = (tpl.replace("__DATES__", dates_js)
           .replace("__STATIONS__", stations_js)
           .replace("__COAST__", coast_js)
           .replace("__HORIZON_METRICS__", hz_js))

with open(OUT, "w", encoding="utf-8") as f:
    f.write(html)
print(f"Wrote {OUT} ({os.path.getsize(OUT)} bytes)")