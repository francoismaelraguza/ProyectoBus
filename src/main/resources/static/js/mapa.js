// Mapa Leaflet: capas, paradas, recorrido y marcadores. Las vistas solo llaman a estas funciones.

import { esc, icono, insignia, colorSeguro, tintaSobre } from "./ui.js";

const CORUNA = [43.3623, -8.4115];
// Clave pública de CARTO: va en cada petición del navegador.
const CARTO_KEY = "cb1_4zpy_1_06146c6b2dad313543d4c4cf";
const TINTA = "#141414";

let mapa;
let capaParadas;
let capaRecorrido;
let capaBuses;
let capaBusesVivo;
let alArrastrarMapa = null;
let capaResalte;
let capaUsuario;
let alClicParada = () => {};
let interceptorClicParada = null;
let capaItinerario;
let itinerarioVisible = false;
let forzarParadas = false;
let recorridoVisible = false;
let obtenerRelleno = () => 0;

const posiciones = new Map();      // id de parada -> [lat, lng]
const marcadores = [];             // circleMarker de las paradas de capaParadas y del recorrido

const reducirMovimiento = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function iniciar(elemento, opciones = {}) {
    alClicParada = opciones.alClicParada ?? alClicParada;
    obtenerRelleno = opciones.obtenerRelleno ?? obtenerRelleno;

    mapa = L.map(elemento, {
        zoomControl: false,
        preferCanvas: true,
        zoomAnimation: !reducirMovimiento(),
        fadeAnimation: !reducirMovimiento(),
        markerZoomAnimation: !reducirMovimiento(),
        renderer: L.canvas({ padding: 0.5, tolerance: 8 }),
    }).setView(CORUNA, 14);

    L.tileLayer(`https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png?key=${CARTO_KEY}`, {
        maxZoom: 20,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    }).addTo(mapa);

    L.control.zoom({
        position: "bottomright",
        zoomInTitle: "Acercar",
        zoomOutTitle: "Alejar",
    }).addTo(mapa);

    if (opciones.botonUbicacion) {
        const Control = L.Control.extend({
            onAdd() {
                L.DomEvent.disableClickPropagation(opciones.botonUbicacion);
                return opciones.botonUbicacion;
            },
        });
        new Control({ position: "bottomright" }).addTo(mapa);
    }

    capaParadas = L.layerGroup().addTo(mapa);
    capaRecorrido = L.layerGroup().addTo(mapa);
    capaResalte = L.layerGroup().addTo(mapa);
    capaBuses = L.layerGroup().addTo(mapa);
    capaBusesVivo = L.layerGroup().addTo(mapa);
    capaUsuario = L.layerGroup().addTo(mapa);

    mapa.on("zoomend", ajustarRadios);
    mapa.on("dragstart", () => alArrastrarMapa?.());

    // Leaflet mide el contenedor al crearse; si el layout cambia después (CSS, hoja, ventana), se vuelve a medir
    if ("ResizeObserver" in window) {
        new ResizeObserver(() => mapa.invalidateSize({ animate: false })).observe(elemento);
    }
    return mapa;
}

const radioSegunZoom = () => (mapa.getZoom() >= 15 ? 5 : 3);

function ajustarRadios() {
    const r = radioSegunZoom();
    for (const m of marcadores) m.setRadius(r);
}

function crearMarcadorParada(p) {
    const m = L.circleMarker([p.lat, p.lng], {
        radius: radioSegunZoom(),
        color: TINTA,
        weight: 1.5,
        fillColor: "#ffffff",
        fillOpacity: 1,
    });
    m.bindTooltip(esc(p.nombre), { direction: "top", offset: [0, -4] });
    m.on("click", () => {
        if (interceptorClicParada?.(p.id)) return;
        alClicParada(p.id);
    });
    posiciones.set(p.id, [p.lat, p.lng]);
    marcadores.push(m);
    return m;
}

/** Todas las paradas del catálogo como puntos pequeños. */
export function pintarParadas(paradas) {
    capaParadas.clearLayers();
    for (const p of paradas) capaParadas.addLayer(crearMarcadorParada(p));
}

/**
 * Dibuja el trazado de una línea (borde blanco + color) y solo sus paradas.
 * { color, trazado: [[lat,lng]], paradas: [{id,nombre,lat,lng}], ajustar }
 */
export function mostrarRecorrido({ color, trazado, paradas = [], ajustar = true }) {
    limpiarRecorrido(false);
    recorridoVisible = true;
    actualizarCapaParadas();
    const c = colorSeguro(color);
    const base = { lineCap: "round", lineJoin: "round", interactive: false };
    capaRecorrido.addLayer(L.polyline(trazado, { ...base, color: "#ffffff", weight: 8, opacity: 1 }));
    capaRecorrido.addLayer(L.polyline(trazado, { ...base, color: c, weight: 5, opacity: 1 }));
    for (const p of paradas) capaRecorrido.addLayer(crearMarcadorParada(p));
    if (ajustar && trazado.length) ajustarA(L.latLngBounds(trazado));
}

/** Quita el recorrido y devuelve el mapa a la vista con todas las paradas. */
export function limpiarRecorrido(restaurar = true) {
    capaRecorrido.clearLayers();
    if (restaurar) {
        recorridoVisible = false;
        actualizarCapaParadas();
    }
}

/** Resalta una parada (más grande, anillo en tinta). null quita el resalte. */
export function resaltarParada(id) {
    capaResalte.clearLayers();
    const pos = posiciones.get(id);
    if (!pos) return;
    capaResalte.addLayer(L.circleMarker(pos, {
        radius: 9, color: TINTA, weight: 3, fillColor: "#ffffff", fillOpacity: 1, interactive: false,
    }));
}

/** buses: [{ lat, lng, nombre, color }] */
export function mostrarBuses(buses) {
    capaBuses.clearLayers();
    for (const b of buses) {
        capaBuses.addLayer(L.marker([b.lat, b.lng], {
            keyboard: false,
            icon: L.divIcon({
                className: "marcador-bus",
                html: insignia({ nombre: b.nombre, color: b.color }),
                iconSize: [44, 24],
                iconAnchor: [22, 28], // por encima del punto, con 4px de separación
            }),
        }));
    }
}

export function limpiarBuses() {
    capaBuses.clearLayers();
}

/** Punto de la ubicación del usuario: tinta con anillo blanco. */
export function marcarUsuario(latlng) {
    capaUsuario.clearLayers();
    capaUsuario.addLayer(L.circleMarker(latlng, {
        radius: 7, color: "#ffffff", weight: 3, fillColor: TINTA, fillOpacity: 1, interactive: false,
    }));
}

/** Encaja unos límites dejando libre la parte tapada por la hoja inferior. */
export function ajustarA(limites, { maxZoom = 17 } = {}) {
    mapa.fitBounds(limites, {
        paddingTopLeft: [24, 24],
        paddingBottomRight: [24, 24 + obtenerRelleno()],
        maxZoom,
        animate: !reducirMovimiento(),
    });
}

/** Centra un punto en la parte visible del mapa. */
export function volarA(latlng, zoom) {
    const z = zoom ?? Math.max(mapa.getZoom(), 16);
    const centro = mapa.unproject(mapa.project(latlng, z).add([0, obtenerRelleno() / 2]), z);
    if (reducirMovimiento()) mapa.setView(centro, z, { animate: false });
    else mapa.flyTo(centro, z, { duration: 0.7 });
}

export function invalidarTamano() {
    mapa?.invalidateSize();
}

// ---------- Itinerario del planificador de rutas ----------

/**
 * Mientras haya un interceptor, pulsar una parada llama a fn(id); si devuelve true
 * no se abre la parada. null lo quita.
 */
export function interceptarClicParada(fn) {
    interceptorClicParada = fn;
}

function marcadorItinerario(parada, opciones) {
    const m = L.circleMarker([parada.lat, parada.lng], { bubblingMouseEvents: false, ...opciones });
    m.bindTooltip(esc(parada.nombre), { direction: "top", offset: [0, -6] });
    return m;
}

/**
 * Dibuja un itinerario: tramos en bus con el color de su línea (5 sobre borde blanco de 8),
 * tramos a pie discontinuos en tinta, salida (anillo hueco), llegada (punto relleno) y las
 * paradas de subida/bajada resaltadas. ajustar=false conserva el encuadre (refrescos).
 */
export function mostrarItinerario(itinerario, { ajustar = true, origen = null, destino = null } = {}) {
    if (!capaItinerario) capaItinerario = L.layerGroup().addTo(mapa);
    capaItinerario.clearLayers();
    itinerarioVisible = true;
    actualizarCapaParadas();
    const tramos = itinerario?.tramos ?? [];
    const puntos = [];
    const base = { lineCap: "round", lineJoin: "round", interactive: false };

    for (const t of tramos) {
        const trazado = t.trazado ?? [];
        if (trazado.length < 2) continue;
        puntos.push(...trazado);
        if (t.tipo === "bus") {
            capaItinerario.addLayer(L.polyline(trazado, { ...base, color: "#ffffff", weight: 8, opacity: 1 }));
            capaItinerario.addLayer(L.polyline(trazado, { ...base, color: colorSeguro(t.color), weight: 5, opacity: 1 }));
        } else {
            capaItinerario.addLayer(L.polyline(trazado, { ...base, lineCap: "butt", color: TINTA, weight: 4, opacity: 1, dashArray: "8 8" }));
        }
    }
    for (const t of tramos) {
        if (t.tipo !== "bus") continue;
        for (const p of [t.desde, t.hasta]) {
            capaItinerario.addLayer(marcadorItinerario(p, { radius: 6, color: TINTA, weight: 2.5, fillColor: "#ffffff", fillOpacity: 1 }));
        }
    }
    if (tramos.length) {
        // Salida y llegada son las paradas elegidas, aunque el bus empiece/termine en otra cercana
        const salida = origen ?? tramos[0].desde;
        const llegada = destino ?? tramos[tramos.length - 1].hasta;
        capaItinerario.addLayer(marcadorItinerario(salida, { radius: 8, color: TINTA, weight: 3, fillColor: "#ffffff", fillOpacity: 1 }));
        capaItinerario.addLayer(marcadorItinerario(llegada, { radius: 8, color: "#ffffff", weight: 3, fillColor: TINTA, fillOpacity: 1 }));
        puntos.push([salida.lat, salida.lng], [llegada.lat, llegada.lng]);
    }
    if (ajustar && puntos.length) ajustarA(L.latLngBounds(puntos));
}

export function limpiarItinerario() {
    capaItinerario?.clearLayers();
    itinerarioVisible = false;
    forzarParadas = false;
    actualizarCapaParadas();
}

/** Con itinerario visible solo se ven sus paradas; true vuelve a mostrar todas (elegir en el mapa). */
export function mostrarTodasParadas(visibles) {
    forzarParadas = visibles;
    actualizarCapaParadas();
}

function actualizarCapaParadas() {
    // El recorrido de una línea siempre oculta el resto; el itinerario lo permite si se piden todas
    const ocultar = recorridoVisible || (itinerarioVisible && !forzarParadas);
    if (ocultar && mapa.hasLayer(capaParadas)) mapa.removeLayer(capaParadas);
    else if (!ocultar && !mapa.hasLayer(capaParadas)) capaParadas.addTo(mapa);
}

// ---------- Buses en vivo ----------

/** Registra (o quita, con null) lo que ocurre cuando el usuario arrastra el mapa. */
export function alArrastrar(fn) {
    alArrastrarMapa = fn;
}

/** Centra un punto en la zona visible sin cambiar el zoom (para seguir un bus). */
export function centrarEn(latlng) {
    const z = mapa.getZoom();
    const centro = mapa.unproject(mapa.project(latlng, z).add([0, obtenerRelleno() / 2]), z);
    mapa.panTo(centro, { animate: !reducirMovimiento(), duration: 1, easeLinearity: 1, noMoveStart: true });
}

const PUNTA_RUMBO = '<svg width="42" height="42" viewBox="0 0 42 42" aria-hidden="true"><path d="M21 0.5 25.5 6.5H16.5Z" fill="currentColor" stroke="#ffffff" stroke-width="1.5" stroke-linejoin="round"/></svg>';

/**
 * Bus en vivo sobre el recorrido: círculo del color de la línea con anillo blanco,
 * pictograma y punta de rumbo. Devuelve un manejador; solo se anima el transform.
 */
export function crearMarcadorBus({ latlng, bus, color, alSeleccionar }) {
    const c = colorSeguro(color);
    const marcador = L.marker(latlng, {
        keyboard: true,
        zIndexOffset: 1000,
        icon: L.divIcon({
            className: "marcador-bus-vivo",
            html: `<span class="bus-vivo" style="--linea:${c};--tinta-linea:${tintaSobre(c)}"><span class="bus-rumbo">${PUNTA_RUMBO}</span><span class="bus-cuerpo">${icono("bus", { tam: 16 })}</span></span>`,
            iconSize: [30, 30],
            iconAnchor: [15, 15],
        }),
    }).addTo(capaBusesVivo);
    marcador.on("click", () => alSeleccionar(bus));

    const el = marcador.getElement();
    const rumboEl = el.querySelector(".bus-rumbo");
    const cuerpo = el.querySelector(".bus-vivo");
    el.setAttribute("role", "button");

    return {
        mover(pos, rumbo) {
            marcador.setLatLng(pos);
            if (rumbo != null) rumboEl.style.transform = `rotate(${rumbo.toFixed(0)}deg)`;
        },
        etiquetar(texto) {
            el.title = texto;
            el.setAttribute("aria-label", texto);
        },
        seguir(si) {
            cuerpo.classList.toggle("seguido", si);
        },
        atenuar(si) {
            marcador.setOpacity(si ? 0.45 : 1);
        },
        quitar() {
            capaBusesVivo.removeLayer(marcador);
        },
    };
}
