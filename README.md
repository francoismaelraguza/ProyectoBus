# 🚌 ProyectoBus

Mapa web en tiempo real de los buses urbanos de **A Coruña**. Muestra las paradas y recorridos de cada línea y, al tocar una parada, cuánto le falta a cada bus para llegar y por dónde va.

Hecho con **Spring Boot 4** (backend) y **Leaflet** (mapa).

> ⚠️ Proyecto personal y educativo. Usa la API **no oficial** que emplea la app iTranvías. No está afiliado a la Compañía de Tranvías de La Coruña ni al Concello. La API puede cambiar o dejar de funcionar sin aviso.

---

## ✨ Funcionalidades

- Mapa con todas las paradas en servicio (las que no tienen líneas asignadas se ocultan).
- Selector de líneas con su color oficial: dibuja el recorrido y filtra sus paradas.
- Al tocar una parada: llegadas por línea con **minutos**, **metros** y **última parada** por la que pasó cada bus.
- Los buses aparecen en el mapa sobre su última parada; tocar un bus en la lista centra el mapa en él.
- Refresco automático cada 20 s.
- Buscador de paradas por nombre o número.
- Paradas favoritas (se guardan en el navegador) y enlace directo: `/?parada=120`.
- Diseño oscuro pensado para móvil.

## 🧱 Arquitectura

```
Navegador (Leaflet)  ──►  Spring Boot (/api)  ──►  itranvias.com/queryitr_v3.php
```

El backend hace de intermediario porque el navegador no puede llamar directamente a iTranvías (CORS) y así se **cachean** las respuestas para no saturar la API:

| Dato | Caché |
|------|-------|
| Catálogo de líneas y paradas | 12 h |
| Llegadas a una parada | 15 s |

Los tiempos se cambian en `application.properties`.

## 🚀 Cómo arrancarlo

Requisitos: **Java 25** y Maven (o IntelliJ, que ya lo trae).

```bash
mvn spring-boot:run
```

Abre <http://localhost:8080>.

En IntelliJ: abre la carpeta, espera a que cargue Maven y ejecuta `ProyectoBusApplication`.

## 🔌 Endpoints propios

| Método | Ruta | Devuelve |
|--------|------|----------|
| GET | `/api/catalogo` | Líneas (nombre, color, recorridos) y paradas (nombre, coordenadas, líneas) |
| GET | `/api/paradas/{id}/llegadas` | Buses que llegan a la parada, ordenados por tiempo |

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

## 📡 La API de iTranvías (no oficial)

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

## 📁 Estructura

```
src/main/java/com/francoraguza/proyectobus/
├── ProyectoBusApplication.java
├── itranvias/          # Cliente HTTP + registros con el JSON crudo de iTranvías
│   ├── ITranviasClient.java
│   └── ITranviasDtos.java
└── api/                # Lógica, caché y endpoints propios
    ├── ApiDtos.java
    ├── BusService.java
    └── BusController.java
src/main/resources/
├── application.properties
└── static/             # Frontend: index.html, styles.css, app.js (Leaflet)
```

## 🗺️ Ideas para seguir

- [ ] Situar el bus entre paradas usando la `distancia` sobre el recorrido (p. ej. con `turf.along`), en vez de sobre su última parada.
- [ ] Ver todos los buses de una línea a la vez (la app oficial tiene una función de "línea" con el diagrama de buses).
- [ ] Botón "paradas cerca de mí" con la geolocalización del navegador.
- [ ] Averiguar qué significa exactamente `estado`.
- [ ] Atajo de Siri: `GET /api/paradas/120/llegadas` → leer en voz alta el próximo 14.
- [ ] Desplegarlo (ojo: algunos hostings en la nube reciben 403 de iTranvías).

## 👤 Autor

Franco Raguza (Pepe) — alumno de DAW en el CIFP Ánxel Casal.
