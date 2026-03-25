# Visor GeoJSON

An interactive geospatial viewer for electrical outage data. Loads a GeoJSON FeatureCollection from the browser, analyzes it locally, and renders an interactive Leaflet map with group-based filtering, a temporal outage timeline, and several analysis panels.

## Running locally

ES modules require a real HTTP server. You cannot open the files directly via `file://`.

```bash
# Python 3
python -m http.server 8080

# Node.js (npx)
npx serve .
```

Then open `http://localhost:8080` in your browser.

## File structure

```text
index.html          Landing page — file upload
mapa.html           Map viewer page
styles/
  index.css         Landing page styles
  mapa.css          Viewer styles
js/
  data-store.js     IndexedDB wrapper (IIFE, window.GeoStore)
  upload.js         Landing page ES module
  workers/
    geo.worker.js   Web Worker for GeoJSON analysis
  modules/
    app.js          Main entry point
    state.js        Shared state factory and element refs
    utils.js        Pure utility functions
    geo-analysis.js Worker launcher and fallback analyzer
    styling.js      Color and style computation
    layers.js       Leaflet feature layer management
    fused.js        Dissolved (fused) geometry view
    groups.js       Group visibility and list rendering
    timeline.js     Temporal outage filter and playback
    ranking.js      Top-groups ranking panel
    info-panel.js   Feature detail side panel
    incidents.js    CSV/Excel incidence point loader
    csv-paint.js    CSV-to-polygon data join and heat coloring
    overlap.js      Polygon overlap resolver
    export.js       GeoJSON and CSV export
    hash-state.js   URL hash state sync
    theme.js        Light/dark theme toggle
```

## Key features

- Loads `.geojson` / `.json` files via drag-and-drop or file picker
- Groups features by a detected property (e.g. `subgrupo`, `grupo`, `sector`)
- Color-codes groups using a 15-color palette
- Timeline slider filters which groups are active at a given minute of the day
- Playback mode animates the timeline automatically
- Fused view dissolves individual polygons per group using Turf.js
- Incidence layer: loads point data from CSV or Excel and clusters markers
- CSV paint: joins external CSV data to polygons and renders a heat-color map
- Overlap resolver: removes polygon overlaps using a smallest-first subtraction strategy
- Exports: visible GeoJSON, fused GeoJSON, summary CSV, resolved GeoJSON
- URL hash preserves map position, active mode, hidden groups, and timeline state

## Expected data format

The viewer expects a GeoJSON `FeatureCollection`. Each feature should have:

- A string property used for grouping (auto-detected; common names: `subgrupo`, `grupo`, `sector`, `zona`, `name`)
- Optionally a `cortes_horas` property with outage time ranges in `HH:MM - HH:MM` format, separated by `|`, `;`, or `,`

Example feature properties:

```json
{
  "subgrupo": "ALI-04A",
  "cortes_horas": "06:00 - 10:00|18:00 - 22:00"
}
```

All data is processed entirely in the browser. Nothing is uploaded to any server.
