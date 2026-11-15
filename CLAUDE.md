# ProyectoBus

Web de tiempos de bus urbano de A Coruña. Backend Spring Boot que hace de proxy con caché de la API **no oficial** de iTranvías; frontend estático (HTML + CSS + JS sin build) con Leaflet.

## Cómo trabajar en este repo

- **Subagentes obligatorios.** Leer y buscar archivos del proyecto → subagente con modelo **Haiku 5.5** (`Explore`, `model: haiku`). Escribir código → subagente con modelo **Sonnet 5.5** (`general-purpose`, `model: sonnet`). La sesión principal solo decide, redacta el encargo, verifica y hace los commits.
- **Skills de diseño.** Cualquier cambio de interfaz pasa por `design-taste-frontend` (rama de *app screens*) y se audita con `web-design-guidelines`.
- **Ramas (Git Flow).** `main` = lo publicado; `develop` = integración (rama por defecto en GitHub). Todo trabajo va en `feature/<nombre>` que sale de `develop` y vuelve por pull request con merge commit (nunca squash ni rebase). A `main` solo se llega por PR desde `release/X.Y.Z` o `hotfix/X.Y.Z`, con tag `vX.Y.Z`. Nada de commits directos en `main` ni en `develop` (están protegidas: PR obligatorio y CI `build` en verde).
- **Pull requests.** Si la rama choca con `develop`, se trae `develop` a la feature (`git merge origin/develop`), se resuelve y se prueba ahí; solo entonces se fusiona el PR. No fusionar con el CI en rojo. La release a `main` la decide el usuario: no hacerla sin que lo pida.
- **Idioma.** Código, comentarios, commits y textos de la interfaz en español.
- Este archivo es el seguimiento del proyecto: actualiza la tabla de estado al cerrar cada tarea.

## Arrancar

Requiere Java 25. No hay `mvnw`; Maven no está en el PATH, se usa el de `~/.m2/wrapper/dists`:

```bash
~/.m2/wrapper/dists/apache-maven-3.9.16/56ba1f9f/bin/mvn.cmd spring-boot:run -Dspring-boot.run.addResources=true
```

`addResources=true` sirve `src/main/resources/static` en caliente (sin recompilar). Abre <http://localhost:8080>. Tests: `mvn.cmd test`.

De noche casi no hay buses (solo el BUH). Para probar con datos, el backend admite otra URL base, p. ej. un iTranvías simulado local:
`-Dspring-boot.run.arguments=--itranvias.base-url=http://localhost:9099`

Maven no puede ir en modo offline (`-o`) para `spring-boot:run` la primera vez: tiene que descargar el plugin.

## Arquitectura

```
Navegador (Leaflet, módulos ES)  →  Spring Boot /api  →  itranvias.com/queryitr_v3.php
```

- `itranvias/` — `ITranviasClient` (HTTP, parsea a mano porque el servidor no siempre manda `application/json`) y `ITranviasDtos` (JSON crudo).
- `api/` — `BusService` (traduce a DTOs propios y cachea), `BusController` (endpoints), `ApiDtos`.
- `resources/static/` — frontend. Sin framework ni bundler: no añadir uno.

Cachés (en `application.properties`): catálogo y recorridos 12 h, llegadas 15 s, buses de línea 8 s.

## API de iTranvías (lo que no es obvio)

Base `https://itranvias.com/queryitr_v3.php`. No exige `User-Agent` de navegador ni `Referer` (comprobado el 2026-11-15): el backend manda el suyo propio.

| Llamada | Qué devuelve |
|---|---|
| `func=7&dato=20160101T000000_gl_0_20160101T000000` | Catálogo: líneas (con `rutas[]` = listas ordenadas de IDs de parada) y paradas |
| `func=0&dato={parada}` | Llegadas a una parada. `distancia` = metros por el recorrido; `tiempo` = minutos |
| `func=2&dato={linea}` | Buses de una línea por sentido: última `parada`, `estado` y `distancia` (fracción 0–1 del recorrido completo ya hecho, **no** metros) |
| `func=99&mostrar=PRB&dato={linea}` | `mapas[]` con tres bloques: `paradas` por sentido, `recorridos` (geometría por calles, texto `lon,lat,0 lon,lat,0 …`) y `buses` con **GPS real** (`posx`/`posy`) |
| `func=1` | Listado de líneas con `dest_ida` / `dest_vuelta` |

- `posx` es **longitud** y `posy` **latitud**.
- El ID interno de línea no es el número × 100 (12A = 1500, BUH = 1800/1801). Traducir siempre con el catálogo.
- `sentido` llega como texto. Hay sentidos residuales (p. ej. `"30"`) con 2 paradas y sin recorrido: ignorarlos.
- Sin buses en servicio la respuesta viene sin `lineas` / con `paradas: []`: es un vacío válido, no un error.
- `func=0` puede traer `"distancia":"--"` (bus que aún no ha salido de cabecera) y `tiempo` como `"--"` o `"<1"`: se leen como texto y se convierten con tolerancia (null = desconocido).
- `func=99` devuelve `"mapas":[[]]` (un bloque que es un array vacío) cuando no hay datos.
- `estado`: 0 detenido, 1 en marcha, 16/17 esperando en cabecera. Un bus en cabecera sale en los dos sentidos a la vez.
- El `sentido` de `func=99 B` numera variantes de ruta (puede ser 2, 3…); el de `func=2` es el 0/1 que coincide con el recorrido. Manda el de `func=2`.
- Responde 429 si se le llama muy seguido: `ITranviasClient` deja 200 ms entre llamadas.
- Algunos hostings en la nube reciben 403.

## Dirección de diseño

Hoja repartida por `design-taste-frontend` (`draw.mjs --app`, semilla 426413680): estilo **achromatic-ledger**, tema claro.

- **Pregunta de la pantalla:** «¿Cuánto falta para mi bus?». La cifra más grande es siempre los minutos del próximo bus.
- **El movimiento:** el cromo no lleva color. El único color es el **oficial de cada línea** (insignia, trazado, bus en el mapa). Botón primario casi negro.
- **Cara propia:** fondo gris azulado `#f1f4f6`, tipografía Geist, y el «termómetro» de línea (paradas en orden sobre una espina del color de la línea) como elemento propio.
- Sin degradados, sombras en reposo, emojis, cristal ni iconos en cuadrados tintados. Radios 8 / 6. Cifras con `tabular-nums`.
- Escritorio: panel lateral de 400 px + mapa. Móvil: mapa a pantalla completa con hoja inferior.

## Estado

Repositorio: <https://github.com/francoismaelraguza/ProyectoBus> (público, sin licencia por ahora). Versión en `pom.xml`: 0.1.0; la primera release prevista es la 0.2.0.

| Rama | Qué contiene | Estado |
|---|---|---|
| `main` | Primera versión (tema oscuro, un solo `app.js`) | Publicada, sin tocar |
| `develop` | Rebuild + buses en vivo + planificador + avisos legales + CI | Integrado y verificado |
| `rebuild/interfaz`, `feature/bus-en-vivo`, `feature/planificador-ruta`, `feature/flujo-git`, `feature/avisos-legales`, `feature/seguimiento` | Ya fusionadas en `develop` (PR 1 a 6) | Borrar tras la release 0.2.0 |

### Release pendiente (0.2.0)

1. `release/0.2.0` desde `develop`: subir `pom.xml` a 0.2.0.
2. PR `release/0.2.0` → `main` con merge commit.
3. Tag anotado `v0.2.0` en `main` y `gh release create v0.2.0`.
4. PR `main` → `develop` para devolver la release.
5. Borrar `release/0.2.0` y las ramas ya integradas (local y remoto).

## Avisos legales (decisiones tomadas)

- La web se declara no oficial y sin relación con la Compañía de Tranvías de La Coruña ni el Concello: pie del panel, vista `?vista=aviso`, README y `noindex`.
- El aviso legal de Tranvías exige autorización previa para reproducir sus contenidos y prohíbe el uso comercial. El descargo no es un permiso: antes de desplegar para el público hay que pedirlo (`correo@tranviascoruna.com`). Sin publicidad ni ingresos.
- Contacto para corrección o retirada: las issues del repositorio.
- Terceros en el navegador: solo las teselas de CARTO (clave propia, uso no comercial, atribución a OpenStreetMap y CARTO). Leaflet y Geist van alojados en `static/vendor/` y `static/fuentes/` con sus licencias: no volver a cargarlos de un CDN.
- El backend se identifica ante iTranvías con `itranvias.user-agent` (`ProyectoBus/…`), sin `Referer` falso.

## Pendiente / ideas

- Planificador: los tiempos de viaje son estimados por distancia (4,5 m/s + 20 s por parada); solo la espera del primer bus es real.
- Bus en vivo: hasta el segundo sondeo (8 s) el bus no se mueve, porque aún no hay velocidad medida.
- Desplegarlo (ojo al 403 desde la nube, y pedir antes la autorización a Tranvías).
- Comprobar si el Punto de Acceso Nacional de transporte publica el GTFS oficial de A Coruña (paradas y líneas como datos abiertos).
