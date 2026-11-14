// Buses en vivo sobre el recorrido de una línea: sondeo, posición sobre el trazado y animación continua.

import * as api from "./api.js";
import { medidasAcumuladas, proyectar, puntoEn } from "./geo.js";
import * as mapa from "./mapa.js";

const SONDEO_MS = 8000;
const VELOCIDAD_MAX = 14;       // m/s
const EXTRAPOLACION_MAX = 120;  // m
const SIN_SENAL_MS = 30_000;
const SALTO_ADELANTE = 400;     // m: más que esto se recoloca sin animar
const SALTO_ATRAS = 60;         // m

const acotar = (x, a, b) => Math.min(b, Math.max(a, x));
const reducirMovimiento = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Medidas del trazado de un sentido y de cada una de sus paradas (proyección monótona hacia delante). */
export function preparar(sentido) {
    const trazado = sentido.trazado;
    const medidas = medidasAcumuladas(trazado);
    const paradasS = [];
    let previa = 0;
    for (const p of sentido.paradas) {
        const punto = [p.lat, p.lng];
        let r = proyectar(trazado, medidas, punto, previa, previa + 2500);
        if (!r || r.dist > 80) r = proyectar(trazado, medidas, punto, previa, Infinity);
        previa = r ? r.s : previa;
        paradasS.push(previa);
    }
    return { trazado, medidas, total: medidas[medidas.length - 1], paradas: sentido.paradas, paradasS };
}

/** Próxima parada a partir de la medida s: { indice, parada, metros }. */
export function siguienteParada(geo, s) {
    let i = geo.paradasS.findIndex((m) => m > s + 5);
    if (i < 0) i = geo.paradas.length - 1;
    return { indice: i, parada: geo.paradas[i], metros: Math.max(0, geo.paradasS[i] - s) };
}

/**
 * Arranca el seguimiento en vivo de un sentido. Opciones:
 *  lineaId, sentido (número), geo (de preparar), color, seguirInicial (nº de bus o null)
 *  alDatos({ consultado, buses }) en cada sondeo bueno
 *  alTermometro(buses) como mucho una vez por segundo
 *  alSenal(perdida, consultado)
 *  alSeleccion(modelo | null)  y  alSeguidoPerdido(nº de bus)
 * Cada bus (modelo): { bus, s (medida dibujada), latlng, rumbo, estado, ultParadaId, conGps }
 */
export function iniciar(op) {
    const { lineaId, sentido, geo, color } = op;
    const conocidos = new Set(op.sentidos.map((x) => x.sentido));
    const buses = new Map();
    let seguido = null;
    let pendiente = op.seguirInicial ?? null;
    let ultimoOk = 0;
    let sinSenal = false;
    let consultado = null;
    let temporizador = null;
    let cuadro = null;
    let control = null;
    let ultimoTick = 0;
    let destruido = false;
    let pausaCentrado = 0;

    // ---------- Sondeo ----------

    async function sondear() {
        clearTimeout(temporizador);
        control?.abort();
        control = new AbortController();
        try {
            const r = await api.busesLinea(lineaId, { signal: control.signal });
            if (destruido) return;
            procesar(r);
            ultimoOk = Date.now();
            fijarSenal(false);
        } catch (e) {
            if (e.name === "AbortError" || destruido) return;
            fallo();
        }
        if (!destruido && !document.hidden) temporizador = setTimeout(sondear, SONDEO_MS);
    }

    function fallo() {
        // Los buses se quedan quietos donde están dibujados
        const ahora = performance.now();
        for (const m of buses.values()) {
            avanzar(m, ahora);
            m.sInicio = m.sObj = m.sMostr;
            m.v = 0;
        }
        if (!ultimoOk || Date.now() - ultimoOk >= SIN_SENAL_MS) fijarSenal(true);
    }

    function fijarSenal(perdida) {
        if (perdida === sinSenal) return;
        sinSenal = perdida;
        for (const m of buses.values()) m.marcador.atenuar(perdida);
        op.alSenal?.(perdida, consultado);
    }

    // ---------- Posición de cada bus ----------

    function medida(b, m) {
        const i = geo.paradas.findIndex((p) => p.id === b.ultParadaId);
        const sParada = i >= 0 ? geo.paradasS[i] : null;
        if (b.lat != null && b.lng != null) {
            const punto = [b.lat, b.lng];
            let r = null;
            if (m.sUlt != null) r = proyectar(geo.trazado, geo.medidas, punto, m.sUlt - 150, m.sUlt + 900);
            else if (sParada != null) r = proyectar(geo.trazado, geo.medidas, punto, sParada - 200, sParada + 1500);
            if (!r || r.dist > 80) r = proyectar(geo.trazado, geo.medidas, punto, 0, Infinity);
            if (r) return r.s;
        }
        if (sParada != null) return sParada;
        if (b.progreso != null) return b.progreso * geo.total;
        return null;
    }

    /** Sentido de un bus; si no existe en /recorrido, el del trazado que le quede a ≤ 80 m (o null). */
    function sentidoDe(b) {
        if (conocidos.has(b.sentido)) return b.sentido;
        if (b.lat == null || b.lng == null) return null;
        let mejor = null;
        for (const x of op.sentidos) {
            const r = proyectar(x.geo.trazado, x.geo.medidas, [b.lat, b.lng]);
            if (r && r.dist <= 80 && (!mejor || r.dist < mejor.dist)) mejor = { sentido: x.sentido, dist: r.dist };
        }
        return mejor ? mejor.sentido : null;
    }

    function procesar(r) {
        const ahora = performance.now();
        consultado = r.consultado;
        const vistos = new Set();

        for (const b of r.buses.filter((x) => sentidoDe(x) === sentido)) {
            let m = buses.get(b.bus);
            const s = medida(b, m ?? {});
            if (s == null) continue;
            vistos.add(b.bus);
            if (!m) {
                m = { bus: b.bus, sUlt: null, tUlt: ahora, v: 0, sMostr: s, sInicio: s, sObj: s, tInicio: ahora, rumbo: null, latlng: null };
                m.marcador = mapa.crearMarcadorBus({
                    latlng: puntoEn(geo.trazado, geo.medidas, s).punto,
                    bus: b.bus,
                    color,
                    alSeleccionar: seleccionar,
                });
                m.marcador.seguir(false);
                m.marcador.atenuar(sinSenal);
                buses.set(b.bus, m);
            }
            m.estado = b.estado;
            m.ultParadaId = b.ultParadaId;
            m.conGps = b.lat != null;

            // Velocidad: lo recorrido desde el dato anterior, acotada y suavizada
            if (m.sUlt != null) {
                const dt = (ahora - m.tUlt) / 1000;
                const vInst = dt > 0 ? acotar((s - m.sUlt) / dt, 0, VELOCIDAD_MAX) : 0;
                m.v = 0.5 * m.v + 0.5 * vInst;
            }
            if (b.estado != null && b.estado !== 1) m.v = 0;   // 0, 16, 17…: detenido

            if (reducirMovimiento()) {
                m.sMostr = m.sInicio = m.sObj = s;
            } else {
                avanzar(m, ahora);
                let desde = m.sMostr;
                if (s - desde > SALTO_ADELANTE || s < desde - SALTO_ATRAS) desde = s;
                m.sInicio = m.sMostr = desde;
                m.tInicio = ahora;
                m.sObj = Math.max(desde, s + Math.min(m.v * (SONDEO_MS / 1000), EXTRAPOLACION_MAX));
            }
            m.sUlt = s;
            m.tUlt = ahora;
        }

        for (const [n, m] of buses) {
            if (vistos.has(n)) continue;
            m.marcador.quitar();
            buses.delete(n);
            if (seguido === n) {
                seguido = null;
                op.alSeguidoPerdido?.(n);
            }
        }

        dibujar(ahora);

        if (pendiente != null) {
            const n = pendiente;
            pendiente = null;
            if (buses.has(n)) seleccionar(n);
            else op.alSeguidoPerdido?.(n);
        }

        etiquetar();
        op.alDatos?.({ consultado, buses: lista() });
        tick(true);
    }

    // ---------- Animación ----------

    function avanzar(m, ahora) {
        const f = reducirMovimiento() ? 1 : acotar((ahora - m.tInicio) / SONDEO_MS, 0, 1);
        m.sMostr = m.sInicio + (m.sObj - m.sInicio) * f;
    }

    function dibujar(ahora) {
        for (const m of buses.values()) {
            avanzar(m, ahora);
            const { punto, rumbo } = puntoEn(geo.trazado, geo.medidas, m.sMostr);
            if (rumbo != null) m.rumbo = rumbo;
            m.latlng = punto;
            m.marcador.mover(punto, m.rumbo);
        }
    }

    function etiquetar() {
        for (const m of buses.values()) {
            const sig = siguienteParada(geo, m.sMostr);
            m.marcador.etiquetar(`Bus ${m.bus}, próxima parada ${sig.parada.nombre}`);
        }
    }

    function lista() {
        return [...buses.values()].map((m) => ({
            bus: m.bus, s: m.sMostr, latlng: m.latlng, rumbo: m.rumbo,
            estado: m.estado, ultParadaId: m.ultParadaId, conGps: m.conGps,
        }));
    }

    /** Como mucho una vez por segundo: termómetro y centrado del bus seguido. */
    function tick(forzar = false, t = performance.now()) {
        if (!forzar && t - ultimoTick < 1000) return;
        ultimoTick = t;
        op.alTermometro?.(lista());
        const m = seguido != null ? buses.get(seguido) : null;
        if (m?.latlng && t >= pausaCentrado) mapa.centrarEn(m.latlng);
    }

    function bucle(t) {
        cuadro = null;
        if (destruido || document.hidden || reducirMovimiento()) return;
        dibujar(t);
        tick(false, t);
        cuadro = requestAnimationFrame(bucle);
    }

    function arrancarBucle() {
        if (cuadro == null && !reducirMovimiento()) cuadro = requestAnimationFrame(bucle);
    }

    // ---------- Selección ----------

    function seleccionar(n) {
        const m = buses.get(n);
        if (!m) return;
        if (seguido != null && seguido !== n) buses.get(seguido)?.marcador.seguir(false);
        seguido = n;
        m.marcador.seguir(true);
        mapa.alArrastrar(() => dejarDeSeguir(false));
        op.alSeleccion?.(modeloPublico(m));   // antes de volar: la hoja puede bajar y cambia el encuadre
        if (m.latlng) {
            pausaCentrado = performance.now() + 1200;   // que el centrado no corte el vuelo
            mapa.volarA(m.latlng);
        }
    }

    function modeloPublico(m) {
        return { bus: m.bus, s: m.sMostr, latlng: m.latlng, estado: m.estado, ultParadaId: m.ultParadaId };
    }

    function dejarDeSeguir(restaurar = true) {
        if (seguido == null) return;
        buses.get(seguido)?.marcador.seguir(false);
        seguido = null;
        mapa.alArrastrar(null);
        op.alSeleccion?.(null, restaurar);
    }

    // ---------- Visibilidad ----------

    function alCambiarVisibilidad() {
        if (document.hidden) {
            clearTimeout(temporizador);
            control?.abort();
            if (cuadro != null) cancelAnimationFrame(cuadro);
            cuadro = null;
        } else {
            sondear();
            arrancarBucle();
        }
    }
    document.addEventListener("visibilitychange", alCambiarVisibilidad);

    sondear();
    arrancarBucle();

    return {
        seleccionar,
        dejarDeSeguir,
        reintentar: sondear,
        /** Modelo actual de un bus (posición dibujada ahora). */
        obtener(n) {
            const m = buses.get(n);
            return m ? modeloPublico(m) : null;
        },
        get seguido() {
            return seguido;
        },
        destruir() {
            destruido = true;
            clearTimeout(temporizador);
            control?.abort();
            if (cuadro != null) cancelAnimationFrame(cuadro);
            document.removeEventListener("visibilitychange", alCambiarVisibilidad);
            mapa.alArrastrar(null);
            for (const m of buses.values()) m.marcador.quitar();
            buses.clear();
        },
    };
}
