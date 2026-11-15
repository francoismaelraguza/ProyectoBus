// Vista «Ruta»: elige salida y llegada y te dice qué buses coger (directo o con trasbordos).

import * as api from "../api.js";
import { datos } from "../estado.js";
import { colorSeguro, distancia, entero, esc, esqueletoFilas, icono, insignia, minutos, NBSP } from "../ui.js";
import { iconoRuta } from "../iconos-ruta.js";
import { crearSelector, htmlSelector } from "../selector-parada.js";
import * as mapa from "../mapa.js";
import * as hoja from "../hoja.js";

const REFRESCO_MS = 30_000;
const NOTA = "Tiempos aproximados: calculados con la distancia entre paradas y la espera del próximo bus.";

export function montar({ contenedor, params }) {
    document.title = "Ruta · ProyectoBus";
    mapa.limpiarRecorrido();
    mapa.limpiarBuses();
    mapa.resaltarParada(null);
    mapa.limpiarItinerario();

    contenedor.innerHTML = `
        <h1>Ruta</h1>
        <form class="ruta-form" novalidate>
            <div class="ruta-campos">
                ${htmlSelector({ id: "campo-origen", etiqueta: "Salida", etiquetaMapa: "Elegir la salida en el mapa" })}
                ${htmlSelector({ id: "campo-destino", etiqueta: "Llegada", etiquetaMapa: "Elegir la llegada en el mapa" })}
            </div>
            <div class="ruta-intercambio">
                <button type="button" class="boton-icono" id="btn-intercambiar" aria-label="Intercambiar salida y llegada">${iconoRuta("intercambiar", { tam: 20 })}</button>
            </div>
            <button type="submit" class="boton boton-primario">Buscar ruta</button>
        </form>
        <div id="ruta-resultados" class="ruta-resultados"></div>
        <p id="ruta-anuncio" class="solo-lectores" role="status" aria-live="polite"></p>`;
    // En móvil la vista ya trae sus dos campos: el buscador global se oculta (ruta.css)
    const panel = document.querySelector("#panel");
    panel.classList.add("panel-ruta");
    const anuncio = contenedor.querySelector("#ruta-anuncio");

    const formulario = contenedor.querySelector(".ruta-form");
    const zona = contenedor.querySelector("#ruta-resultados");

    let cancelado = false;
    let control = null;
    let ficha = 0;          // descarta respuestas obsoletas
    let modo = null;        // campo que se rellena al pulsar una parada del mapa: "origen" | "destino" | null
    let plan = null;        // última respuesta con itinerarios
    let consulta = null;    // { o, d } de la última búsqueda
    let seleccion = 0;
    let ultimaConsulta = 0;

    // ---------- Campos ----------

    const campos = {
        origen: crearSelector(contenedor.querySelector("#campo-origen"), {
            alEnfocar: () => activarModo("origen"),
            alElegir: () => activarModo(null),
            alPulsarMapa: () => activarModo("origen", { desdeBoton: true }),
        }),
        destino: crearSelector(contenedor.querySelector("#campo-destino"), {
            alEnfocar: () => activarModo("destino"),
            alElegir: () => activarModo(null),
            alPulsarMapa: () => activarModo("destino", { desdeBoton: true }),
        }),
    };

    function activarModo(campo, { desdeBoton = false } = {}) {
        modo = campo;
        campos.origen.ayuda(modo === "origen");
        campos.destino.ayuda(modo === "destino");
        mapa.mostrarTodasParadas(modo !== null);
        // En móvil se baja la hoja para dejar ver el mapa donde se va a pulsar
        if (desdeBoton && campo) hoja.bajarComoMuchoA("medio");
    }

    // Pulsar una parada del mapa rellena el campo activo en vez de abrir la parada
    mapa.interceptarClicParada((id) => {
        if (!modo) return false;
        campos[modo].fijar(id);
        activarModo(null);
        return true;
    });

    formulario.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && modo) {
            e.preventDefault();
            activarModo(null);
        }
    });
    // Si el foco se va a otra parte de la interfaz, deja de estar activo «elegir en el mapa»
    formulario.addEventListener("focusout", (e) => {
        if (e.relatedTarget && !formulario.contains(e.relatedTarget)) activarModo(null);
    });

    formulario.addEventListener("submit", (e) => {
        e.preventDefault();
        enviar();
    });

    contenedor.querySelector("#btn-intercambiar").addEventListener("click", () => {
        const o = campos.origen.resolver();
        const d = campos.destino.resolver();
        campos.origen.fijar(d);
        campos.destino.fijar(o);
        activarModo(null);
        if (o != null && d != null && o !== d && (plan || consulta)) enviar();
    });

    function enviar() {
        activarModo(null);
        const o = campos.origen.resolver();
        const d = campos.destino.resolver();
        campos.origen.error(null);
        campos.destino.error(null);
        let primero = null;
        if (o == null) {
            campos.origen.error("Elige una parada de la lista.");
            primero = campos.origen;
        }
        if (d == null) {
            campos.destino.error("Elige una parada de la lista.");
            primero ??= campos.destino;
        }
        if (!primero && o === d) {
            campos.destino.error("Elige dos paradas distintas.");
            primero = campos.destino;
        }
        if (primero) {
            primero.enfocar();
            return;
        }
        const busqueda = `?vista=ruta&origen=${o}&destino=${d}`;
        if (location.search !== busqueda) history.pushState(null, "", location.pathname + busqueda);
        calcular(o, d);
    }

    // ---------- Cálculo ----------

    async function calcular(o, d, { silencioso = false } = {}) {
        const mia = ++ficha;
        control?.abort();
        control = new AbortController();
        consulta = { o, d };
        if (!silencioso) {
            plan = null;
            mapa.limpiarItinerario();
            zona.innerHTML = `<div class="ruta-opciones" aria-hidden="true">${[0, 1].map(() => `<div class="ruta-opcion">${esqueletoFilas(1)}</div>`).join("")}</div>`;
        }
        try {
            const nuevo = await api.ruta(o, d, { signal: control.signal });
            if (cancelado || mia !== ficha) return;
            ultimaConsulta = Date.now();
            if (!nuevo.itinerarios?.length) {
                plan = null;
                mapa.limpiarItinerario();
                zona.innerHTML = `<p class="tarjeta-vacia">No hay combinación de buses entre estas paradas. Prueba con una parada cercana.</p>`;
                anuncio.textContent = "No hay combinación de buses entre estas paradas.";
                return;
            }
            mostrar(nuevo, silencioso);
        } catch (e) {
            if (e.name === "AbortError" || cancelado || mia !== ficha) return;
            if (silencioso && plan) return;   // el refresco falla en silencio: se conserva lo que había
            plan = null;
            mapa.limpiarItinerario();
            zona.innerHTML = `<div class="tarjeta"><div class="fila fila-error"><p>No se pudo calcular la ruta.</p><button type="button" class="boton-texto" data-reintentar>Reintentar</button></div></div>`;
            anuncio.textContent = "No se pudo calcular la ruta.";
        }
    }

    function mostrar(nuevo, silencioso) {
        const previo = plan;
        const firmaPrevia = silencioso && previo ? firma(previo.itinerarios[seleccion]) : null;
        plan = nuevo;
        const i = firmaPrevia ? nuevo.itinerarios.findIndex((it) => firma(it) === firmaPrevia) : 0;
        seleccion = Math.max(0, i);

        const sinCambios = silencioso && previo &&
            JSON.stringify(previo.itinerarios) === JSON.stringify(nuevo.itinerarios);
        if (!sinCambios) {
            const foco = zona.contains(document.activeElement);
            zona.innerHTML = `<div class="ruta-opciones" role="radiogroup" aria-label="Opciones de ruta">${nuevo.itinerarios.map((it, k) => construirOpcion(it, k, k === seleccion)).join("")}</div><p class="ruta-nota">${NOTA}</p>`;
            if (foco) zona.querySelector('[role="radio"][tabindex="0"]')?.focus({ preventScroll: true });
            pintarMapa(!silencioso);
        }
        if (!silencioso) {
            anuncio.textContent = resumenAnuncio(nuevo);
            hoja.bajarComoMuchoA("medio");
            document.title = `Ruta de ${nuevo.origen.nombre} a ${nuevo.destino.nombre} · ProyectoBus`;
        }
    }

    function seleccionar(i, { enfocar = false } = {}) {
        if (!plan || i < 0 || i >= plan.itinerarios.length) return;
        const cambia = i !== seleccion;
        seleccion = i;
        zona.querySelectorAll(".ruta-opcion").forEach((el, k) => {
            const activa = k === i;
            el.classList.toggle("seleccionada", activa);
            const radio = el.querySelector('[role="radio"]');
            radio.setAttribute("aria-checked", String(activa));
            radio.tabIndex = activa ? 0 : -1;
            el.querySelector(".ruta-pasos").hidden = !activa;
        });
        const radio = zona.querySelector(`#ruta-op-${i}`);
        if (enfocar) radio?.focus();
        radio?.scrollIntoView({ block: "nearest" });
        if (cambia) pintarMapa(true);
    }

    function pintarMapa(ajustar) {
        mapa.mostrarItinerario(plan.itinerarios[seleccion], { ajustar, origen: plan.origen, destino: plan.destino });
    }

    zona.addEventListener("click", (e) => {
        if (e.target.closest("[data-reintentar]")) {
            if (consulta) calcular(consulta.o, consulta.d);
            return;
        }
        const radio = e.target.closest('[role="radio"]');
        if (radio) seleccionar(Number(radio.dataset.i));
    });
    zona.addEventListener("keydown", (e) => {
        const radio = e.target.closest('[role="radio"]');
        if (!radio || !plan) return;
        const n = plan.itinerarios.length;
        const i = Number(radio.dataset.i);
        let destino = null;
        switch (e.key) {
            case "ArrowDown":
            case "ArrowRight": destino = (i + 1) % n; break;
            case "ArrowUp":
            case "ArrowLeft": destino = (i - 1 + n) % n; break;
            case "Home": destino = 0; break;
            case "End": destino = n - 1; break;
            case " ":
            case "Enter": destino = i; break;
            default: return;
        }
        e.preventDefault();
        seleccionar(destino, { enfocar: true });
    });

    // ---------- Refresco de la espera cada 30 s mientras la pestaña esté visible ----------

    function refrescar() {
        if (plan && consulta && !document.hidden) calcular(consulta.o, consulta.d, { silencioso: true });
    }
    const temporizador = setInterval(refrescar, REFRESCO_MS);
    const alVisible = () => {
        if (!document.hidden && Date.now() - ultimaConsulta >= REFRESCO_MS) refrescar();
    };
    document.addEventListener("visibilitychange", alVisible);

    // ---------- Arranque desde la URL ----------

    zona.innerHTML = `<p class="tarjeta-vacia">Elige una parada de salida y otra de llegada.</p>`;

    const idDe = (clave) => {
        const id = Number(params.get(clave));
        return params.has(clave) && datos.paradaPorId.has(id) ? id : null;
    };
    const o0 = idDe("origen");
    const d0 = idDe("destino");
    if (o0 != null) campos.origen.fijar(o0);
    if (d0 != null) campos.destino.fijar(d0);

    if (o0 != null && d0 != null) {
        if (o0 === d0) {
            campos.destino.error("Elige dos paradas distintas.");
        } else {
            calcular(o0, d0);
        }
    } else if (o0 != null || d0 != null) {
        // El router enfoca el h1 al terminar de montar: el foco al otro campo va después
        const otro = o0 != null ? campos.destino : campos.origen;
        setTimeout(() => { if (!cancelado) otro.enfocar(); }, 0);
    }

    return {
        destruir() {
            cancelado = true;
            control?.abort();
            clearInterval(temporizador);
            document.removeEventListener("visibilitychange", alVisible);
            mapa.interceptarClicParada(null);
            panel.classList.remove("panel-ruta");
            mapa.limpiarItinerario();
        },
    };
}

// ---------- Pintado de resultados ----------

/** Identifica un itinerario por sus buses y paradas de subida/bajada (para conservar la selección). */
function firma(it) {
    return it ? it.tramos.map((t) => (t.tipo === "bus" ? `${t.lineaId}:${t.desde.id}-${t.hasta.id}` : "a")).join("|") : "";
}

const lineaDeTramo = (t) => ({ nombre: t.lineaNombre, color: t.color });

const plurales = new Intl.PluralRules("es");
const plural = (n, uno, otros) => (plurales.select(n) === "one" ? uno : otros);
const MIN_ANDAR_VISIBLE_M = 100;

function resumenTexto(it) {
    const hayBus = it.tramos.some((t) => t.tipo === "bus");
    if (!hayBus) return `Solo andando · ${distancia(it.metrosAndando)}`;
    const partes = [it.trasbordos === 0 ? "Directo" : `${entero(it.trasbordos)} ${plural(it.trasbordos, "trasbordo", "trasbordos")}`];
    if (it.metrosAndando >= MIN_ANDAR_VISIBLE_M) partes.push(`${distancia(it.metrosAndando)} andando`);
    return partes.join(" · ");
}

/** Frase para la región aria-live al llegar resultados. */
function resumenAnuncio(plan) {
    const n = plan.itinerarios.length;
    const mejor = plan.itinerarios[0];
    const lineas = [...new Set(mejor.tramos.filter((t) => t.tipo === "bus").map((t) => t.lineaNombre))];
    const con = !lineas.length ? "andando"
        : `con ${plural(lineas.length, "la línea", "las líneas")} ${lineas.join(" y ")}`;
    return `${entero(n)} ${plural(n, "opción", "opciones")}. La más rápida: ${entero(mejor.minutos)} minutos ${con}.`;
}

function construirOpcion(it, i, activa) {
    const secuencia = it.tramos.filter((t) => t.tipo === "bus" || t.metros >= MIN_ANDAR_VISIBLE_M).map((t) =>
        t.tipo === "bus" ? insignia(lineaDeTramo(t)) : `<span class="ruta-andar">${iconoRuta("andar")}</span>`
    ).join(`<span class="chevron">${icono("chevron", { tam: 14 })}</span>`);

    const lineas = it.tramos.filter((t) => t.tipo === "bus").map((t) => t.lineaNombre);
    const nombre = lineas.length ? `${lineas.length === 1 ? "línea" : "líneas"} ${lineas.join(", ")}` : "a pie";
    const etiqueta = `Opción ${i + 1}: ${nombre}, ${entero(it.minutos)} minutos, ${resumenTexto(it).toLowerCase()}`;

    return `<div class="ruta-opcion${activa ? " seleccionada" : ""}">
        <div class="ruta-resumen" role="radio" id="ruta-op-${i}" data-i="${i}" aria-checked="${activa}" tabindex="${activa ? 0 : -1}" aria-label="${esc(etiqueta)}">
            <div class="ruta-info">
                <div class="ruta-secuencia" aria-hidden="true">${secuencia}</div>
                <p class="fila-sub">${esc(resumenTexto(it))}</p>
            </div>
            <span class="cifra"><span class="cifra-num">${entero(it.minutos)}</span><span class="cifra-unidad">${NBSP}min</span></span>
        </div>
        <ol class="ruta-pasos" aria-label="Pasos de la opción ${i + 1}"${activa ? "" : " hidden"}>${pasosHtml(it)}</ol>
    </div>`;
}

const enlaceParada = (p) => `<a class="enlace-texto" href="?parada=${Number(p.id)}">${esc(p.nombre)}</a>`;

function pasosHtml(it) {
    const primerBus = it.tramos.findIndex((t) => t.tipo === "bus");
    return it.tramos.map((t, i) => {
        if (t.tipo !== "bus") {
            return `<li class="paso paso-andar"><p>Camina ${distancia(t.metros)} hasta ${enlaceParada(t.hasta)} · ${minutos(t.minutos)}</p></li>`;
        }
        const color = colorSeguro(t.color);
        let espera = "";
        if (i === primerBus) {
            const texto = t.esperaMin == null ? "Sin bus en camino ahora"
                : t.esperaMin === 0 ? "Llegando" : `Próximo bus en ${minutos(t.esperaMin)}`;
            espera = `<p class="paso-sub">${texto}</p>`;
        }
        const enlaceLinea = `<a class="paso-linea" href="?linea=${Number(t.lineaId)}" aria-label="Línea ${esc(t.lineaNombre)}">${insignia(lineaDeTramo(t), { pequena: true })}</a>`;
        const paradas = `${entero(t.paradas)}${NBSP}${plural(t.paradas, "parada", "paradas")}`;
        return `<li class="paso paso-sube" style="--linea:${color}"><p>Sube al ${enlaceLinea} en ${enlaceParada(t.desde)} hacia ${esc(t.hacia)}</p>${espera}</li>`
            + `<li class="paso paso-baja" style="--linea:${color}"><p>Baja en ${enlaceParada(t.hasta)} · ${paradas} · ${minutos(t.minutos)}</p></li>`;
    }).join("");
}
