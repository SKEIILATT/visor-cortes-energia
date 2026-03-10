# Visor GeoJSON v5 (versión mejorada)

## Contexto
Esta carpeta (`v5-web-humano`) es una evolución completa de la versión anterior (`v4-web`) y **no modifica el proyecto original**.
La idea fue pasar de un visor funcional a una herramienta más robusta, explicable y mantenible.

## Qué mejoré

### 1) Arquitectura y escalabilidad
- Reemplacé el flujo de `localStorage` por **IndexedDB** para soportar datasets más grandes.
- El mapa ya no depende de un único blob en memoria de la página anterior.
- La navegación ahora se hace con `mapa.html?dataset=<id>`.

### 2) Rendimiento
- Agregué un **Web Worker** (`js/workers/geo.worker.js`) para analizar:
  - agrupación automática,
  - franjas de corte,
  - buckets del timeline,
  - esquema de propiedades.
- Si el Worker no está disponible (por ejemplo, según contexto del navegador), existe un **fallback local** en `mapa.js`.

### 3) Funcionalidades analíticas nuevas
- Filtro por atributos (campo + operador + valor).
- Timeline con reproducción y velocidades (`1x`, `4x`, `8x`).
- Modo de color:
  - por grupo,
  - por intensidad de horas de corte.
- Ranking de grupos (general y por instante del timeline).
- Panel de detalle por feature con propiedades y franjas.

### 4) Incidencias (CSV/Excel) mejoradas
- Parser más robusto con `PapaParse` para CSV.
- Soporte Excel (`xlsx`, `xls`) con `xlsx`.
- Detección flexible de columnas de lat/lon.
- Visualización con **cluster opcional** (`Leaflet.markercluster`).

### 5) Exportación y colaboración
- Exportación de vista filtrada a **GeoJSON**.
- Exportación de resumen por grupos a **CSV**.
- Botón de **compartir vista** con estado guardado en URL hash:
  - centro/zoom,
  - minuto del timeline,
  - modo de color,
  - grupos ocultos,
  - filtro activo.

### 6) UI/UX y estilo
- Rediseño completo con una estética más sobria y natural.
- Mejor responsive para móvil (sidebar colapsable, paneles adaptativos).
- Eliminé `onclick` inline y pasé a listeners en JS.

## Estructura principal

- `index.html`: carga inicial de GeoJSON
- `mapa.html`: interfaz principal del visor
- `js/data-store.js`: capa de persistencia en IndexedDB
- `js/index.js`: validación y guardado del dataset
- `js/mapa.js`: lógica del visor, filtros, timeline, exportaciones, incidencias
- `js/workers/geo.worker.js`: análisis pesado fuera del hilo principal
- `styles/index.css`: estilos de la pantalla de carga
- `styles/mapa.css`: estilos del visor principal

## Cómo ejecutar

### Opción rápida
1. Abre `index.html` en navegador.
2. Carga un `.geojson`.
3. Entra al mapa y usa filtros/timeline.

### Opción recomendada (para máxima compatibilidad)
Levantar un servidor local simple en esta carpeta, por ejemplo:

```powershell
# desde v5-web-humano
python -m http.server 5500
```

Luego abrir: `http://localhost:5500/index.html`

## Diferencias clave vs v4
- `v4`: transporte por `localStorage`, menos escalable para archivos grandes.
- `v5`: persistencia en IndexedDB + análisis en Worker + exportaciones + URL compartible.
- `v4`: parser CSV básico.
- `v5`: parser robusto y soporte real CSV/Excel.
- `v4`: estilo más rígido y menos adaptable.
- `v5`: interfaz más limpia, más legible y mejor en móvil.

## Cómo explicarlo (guion corto)

> "Lo que hice fue rehacer la app en una versión paralela para no tocar la base original.
> El principal cambio técnico fue pasar a IndexedDB y mover el análisis geoespacial a Worker para evitar bloqueos.
> Además añadí filtros por atributos, timeline reproducible, ranking dinámico, carga robusta de incidencias y exportaciones en GeoJSON/CSV.
> A nivel de UX, rediseñé la interfaz para que sea más clara y usable en escritorio y móvil, y agregué una URL de estado para compartir vistas exactas." 

## Limitaciones actuales y próximos pasos
- Para datasets extremadamente grandes (decenas de MB con geometrías muy complejas), el siguiente paso sería vector tiles.
- Se puede añadir autenticación/permisos si luego se integra en entorno institucional.
- Se puede incorporar un módulo de métricas de desempeño para comparar tiempos por dataset.

---

## Nota
La versión original queda intacta en `v4-web`. Esta versión nueva vive totalmente separada en `v5-web-humano` para poder comparar comportamiento y código lado a lado.
