# ProyectoBus

Mapa web en tiempo real de los buses urbanos de **A Coruña**. Muestra las paradas y recorridos de cada línea y, al tocar una parada, cuánto le falta a cada bus para llegar y por dónde va.

Hecho con **Spring Boot 4** (backend) y **Leaflet** (mapa).

> Proyecto personal y educativo, **no oficial**: sin relación con la Compañía de Tranvías de La Coruña ni con el Concello. Usa la API no oficial de iTranvías, que puede cambiar o dejar de funcionar sin aviso. Ver [Aviso legal y uso de datos](#aviso-legal-y-uso-de-datos).

---

## Funcionalidades

- Mapa con todas las paradas en servicio (las que no tienen líneas asignadas se ocultan); tocar una abre la parada.
- **Paradas**: favoritas con sus próximas llegadas en vivo (se refrescan cada 30 s) y «Cerca de ti» con la geolocalización del navegador.
- **Parada** (`/?parada=120`): llegadas por línea con los minutos del próximo bus en grande, distancia, última parada por la que pasó y los siguientes buses. Refresco cada 20 s; los buses se dibujan en el mapa y tocar uno lo centra.
- **Líneas** (`/?vista=lineas`): todas las líneas con su color oficial.
- **Línea** (`/?linea=1400&sentido=0`): recorrido real por calles, paradas del sentido y «termómetro» con las otras líneas que paran en cada una.
- **Ruta** (`/?vista=ruta&origen=120&destino=45`): eliges parada de salida y de llegada y la web te dice qué buses coger, directo o con hasta 2 trasbordos, con tiempos aproximados. Hasta 3 alternativas (otras líneas, o solo andando si están a menos de 1 km), la espera real del primer bus y el recorrido dibujado en el mapa. Las paradas se escriben en el campo o se eligen pulsando en el mapa. Desde una parada hay atajos «Salir desde aquí» / «Llegar aquí».
- **Buses en vivo** en la línea: cada bus se desliza de forma continua por el trazado (sondeo cada 8 s, velocidad estimada a partir de lo recorrido) y aparece también sobre el termómetro. Tocar un bus lo sigue en el mapa (`&bus=395`); desde una parada, cada llegada enlaza al bus de esa línea.
- Buscador de paradas y líneas (nombre sin acentos o número), con teclado.
- Favoritas guardadas en el navegador. Diseño claro, panel lateral en escritorio y hoja inferior en móvil.

## Arquitectura

```
Navegador (Leaflet)  ──►  Spring Boot (/api)  ──►  itranvias.com/queryitr_v3.php
```

El backend hace de intermediario porque el navegador no puede llamar directamente a iTranvías (CORS) y así se **cachean** las respuestas para no saturar la API:

| Dato | Caché |
|------|-------|
| Catálogo de líneas y paradas | 12 h |
| Llegadas a una parada | 15 s |
| Recorrido (paradas y trazado) de una línea | 12 h |
| Buses de una línea (posición en vivo) | 8 s |

Los tiempos se cambian en `application.properties`.

## Cómo arrancarlo

Requisitos: **Java 25** y Maven (o IntelliJ, que ya lo trae).

```bash
mvn spring-boot:run
```

Abre <http://localhost:8080>.

En IntelliJ: abre la carpeta, espera a que cargue Maven y ejecuta `ProyectoBusApplication`.

## Endpoints propios

| Método | Ruta | Devuelve |
|--------|------|----------|
| GET | `/api/catalogo` | Líneas (nombre, color, recorridos) y paradas (nombre, coordenadas, líneas) |
| GET | `/api/paradas/{id}/llegadas` | Buses que llegan a la parada, ordenados por tiempo |
| GET | `/api/lineas/{id}/buses` | Buses de la línea ahora: sentido, GPS (`lat`/`lng`, puede ser null), última parada, `estado` (0 detenido, 1 en marcha, 17 en cabecera) y `progreso` (0–1) |
| GET | `/api/lineas/{id}/recorrido` | Por sentido: destino, paradas en orden y trazado `[lat, lng]` por calles (404 si la línea no existe) |
| GET | `/api/ruta?origen={idParada}&destino={idParada}` | Itinerarios para ir de una parada a otra (ver abajo). 400 si falta un parámetro o son la misma parada; 404 si una parada no existe |

Ejemplo de `/api/paradas/120/llegadas` (Rda. de Outeiro, 126):

```json
{
  "parada": 120,
  "nombre": "Rda. de Outeiro, 126",
  "consultado": "16:45:42",
  "lineas": [
    {
      "id": 1400, "nombre": "14", "color": "#025BBF",
      "buses": [
        { "bus": 395, "minutos": 13, "distancia": 2516, "estado": 1,
          "ultParadaId": 21, "ultParadaNombre": "Av. do Exército, glorieta",
          "lat": 43.355293, "lng": -8.395613 }
      ]
    }
  ]
}
```

### Planificador de rutas — `/api/ruta`

Dijkstra por tiempo sobre un grafo de estados (parada a pie / posición en una ruta, buses usados). Modelo: espera de 5 min en el primer bus y 7 min en cada trasbordo; el bus recorre la distancia en línea recta × 1,25 a 4,5 m/s más 20 s por parada; a pie se puede ir entre paradas a ≤ 350 m (distancia × 1,3 a 1,25 m/s), lo que cubre la parada de la acera de enfrente. Máximo 2 trasbordos.

Se calcula la mejor opción y después se repite prohibiendo, de una en una, cada línea usada para sacar alternativas distintas (se descartan las que tardan más de 1,6 × la mejor + 10 min; máximo 3). Si la salida y la llegada están a ≤ 1 km se añade «solo andando». Para el primer tramo en bus se consultan las llegadas reales (`esperaMin`; `null` si no viene ningún bus de esa línea o falla la consulta).

```json
{
  "origen": { "id": 120, "nombre": "Rda. de Outeiro, 126", "lat": 43.35, "lng": -8.40 },
  "destino": { "id": 45, "nombre": "…", "lat": 43.36, "lng": -8.41 },
  "consultado": "16:45:42",
  "itinerarios": [
    { "minutos": 27, "trasbordos": 0, "metrosAndando": 180,
      "tramos": [
        { "tipo": "andar", "desde": { "…": "…" }, "hasta": { "…": "…" }, "metros": 180, "minutos": 3, "trazado": [[43.35, -8.40], [43.351, -8.401]] },
        { "tipo": "bus", "lineaId": 1400, "lineaNombre": "14", "color": "#025BBF", "hacia": "…",
          "desde": { "…": "…" }, "hasta": { "…": "…" }, "paradas": 8, "metros": 2900, "minutos": 14,
          "esperaMin": 4, "trazado": [[43.351, -8.401], [43.36, -8.41]] }
      ] }
  ]
}
```

`minutos` de un tramo es solo el trayecto (sin la espera); el total del itinerario sí la incluye. Sin combinación posible devuelve `itinerarios: []`. Los tiempos son una estimación, no un horario.

## La API de iTranvías (no oficial)

Base: `https://itranvias.com/queryitr_v3.php`

### Catálogo — `func=7`

```
?func=7&dato=20160101T000000_gl_0_20160101T000000
```

Dentro de `iTranvias.actualizacion`:

- `lineas[]`: `id` (código interno), `lin_comer` (número que ve la gente), `nombre_orig`, `nombre_dest`, `color` (hex sin `#`), `rutas[]` → cada ruta es una lista **ordenada** de IDs de parada (ida, vuelta y variantes).
- `paradas[]`: `id`, `nombre`, `posx` (**longitud**), `posy` (**latitud**), `enlaces` (IDs de las líneas que paran).

Ojo: el código interno **no** es siempre el número × 100.

| Línea | Código interno |
|-------|----------------|
| 1 | 100 |
| 1A | 1900 |
| 2A | 800 |
| 12 | 1200 |
| 12A | 1500 |
| 14 | 1400 |
| BUH | 1800 / 1801 |
| UDC | 2450 / 2451 |

Siempre hay que traducirlo con el catálogo.

### Llegadas — `func=0`

```
?func=0&dato={idParada}
```

`buses.lineas[]` → `linea` (código interno) y `buses[]` con:

| Campo | Significado |
|-------|-------------|
| `bus` | Número del vehículo |
| `tiempo` | Minutos hasta la parada (viene como texto) |
| `distancia` | Metros **por el recorrido** hasta la parada (texto) |
| `estado` | 0 / 1 — sin documentar, parece indicar si está parado o en marcha |
| `ult_parada` | ID de la última parada por la que pasó |

> El `dato` es el **ID** de la parada, no el número de la calle: "Rda. de Outeiro, 126" es la parada **120**.

## Aviso legal y uso de datos

- **No oficial ni afiliado.** ProyectoBus es un proyecto personal, educativo y sin ánimo de lucro. No tiene relación, patrocinio ni aprobación de la Compañía de Tranvías de La Coruña, S.A. ni del Concello da Coruña. «iTranvías» se menciona solo para indicar el origen de los datos.
- **Los datos son de su titular.** Líneas, paradas, tiempos y posiciones pertenecen a sus titulares; este proyecto no concede ningún derecho sobre ellos y no garantiza su exactitud ni disponibilidad.
- **Uso responsable de la API.** Cachés: catálogo y recorridos 12 h, llegadas 15 s, buses de línea 8 s; 200 ms mínimo entre llamadas; el backend se identifica con su propio `User-Agent` (`itranvias.user-agent`, sin `Referer`).
- **Antes de publicarlo.** El aviso legal de Tranvías exige autorización previa para reproducir sus contenidos y prohíbe el uso comercial, así que antes de desplegarlo para el público hay que pedir permiso.
- **Mapa.** Teselas de CARTO con clave propia: uso no comercial y atribución obligatoria (© OpenStreetMap, © CARTO).
- **Privacidad.** Sin cookies, analítica ni registro. Las favoritas se guardan solo en el navegador; la ubicación se usa únicamente en el navegador y no se envía a ningún servidor. CARTO recibe la IP al servir las imágenes del mapa.
- **Terceros incluidos en el repositorio.** Leaflet (BSD-2-Clause, `src/main/resources/static/vendor/leaflet/LICENSE`) y Geist (SIL OFL 1.1, `src/main/resources/static/fuentes/OFL.txt`).
- **Licencia:** este repositorio no tiene licencia de código abierto por ahora; todos los derechos reservados.

## Estructura

```
src/main/java/com/francoraguza/proyectobus/
├── ProyectoBusApplication.java
├── itranvias/          # Cliente HTTP + registros con el JSON crudo de iTranvías
│   ├── ITranviasClient.java
│   └── ITranviasDtos.java
└── api/                # Lógica, caché y endpoints propios
    ├── ApiDtos.java
    ├── BusService.java
    ├── PlanificadorService.java   # Dijkstra de /api/ruta (lógica pura sobre el catálogo)
    └── BusController.java
src/main/resources/
├── application.properties
└── static/             # Frontend sin build: HTML + CSS + módulos ES + Leaflet
    ├── index.html, styles.css, ruta.css
    ├── vendor/leaflet/   # Leaflet 1.9.4 auto-alojado (BSD-2-Clause, con su LICENSE)
    ├── fuentes/          # Geist (woff2 latin y latin-ext) y su licencia OFL.txt
    └── js/
        ├── app.js        # router y pestañas (lista de vistas en un solo array)
        ├── api.js, estado.js, geo.js, ui.js
        ├── mapa.js, hoja.js, buscador.js
        ├── envivo.js     # sondeo y animación de los buses sobre el trazado
        ├── selector-parada.js, iconos-ruta.js   # combobox de paradas reutilizable e iconos del planificador
        └── vistas/       # inicio, parada, lineas, linea, ruta, aviso (aviso legal, sin pestaña)
src/test/java/…/api/PlanificadorServiceTest.java   # pruebas del planificador con un catálogo sintético
```

## Flujo de ramas

El proyecto sigue Git Flow con pull requests:

| Rama | Sale de | Vuelve a | Para qué |
|---|---|---|---|
| `main` | — | — | Lo publicado. Cada entrada lleva un tag `vX.Y.Z`. |
| `develop` | `main` | — | Integración. Es la rama por defecto. |
| `feature/<nombre>` | `develop` | `develop` | Una funcionalidad o cambio. |
| `release/X.Y.Z` | `develop` | `main` y `develop` | Preparar una versión. |
| `hotfix/X.Y.Z` | `main` | `main` y `develop` | Arreglo urgente de lo publicado. |

- `main` y `develop` están protegidas: solo se entra por pull request y con el CI (`mvn verify`) en verde.
- Los PR se fusionan con merge commit, para que el historial conserve cada rama.
- Si una feature choca con `develop`, se trae `develop` a la feature, se resuelve ahí y después se fusiona.

## Ideas para seguir

- [ ] Situar el bus entre paradas usando la `distancia` sobre el recorrido (p. ej. con `turf.along`), en vez de sobre su última parada.
- [ ] Ver todos los buses de una línea a la vez (la app oficial tiene una función de "línea" con el diagrama de buses).
- [ ] Averiguar qué significa exactamente `estado`.
- [ ] Atajo de Siri: `GET /api/paradas/120/llegadas` → leer en voz alta el próximo 14.
- [ ] Desplegarlo (ojo: algunos hostings en la nube reciben 403 de iTranvías).

## Autor

Franco Raguza (Pepe) — alumno de DAW en el CIFP Ánxel Casal.
