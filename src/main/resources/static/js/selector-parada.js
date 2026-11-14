// Selector de parada reutilizable: combobox ARIA (flechas, Enter, Escape) con búsqueda
// sin acentos por nombre o número de parada. Inspirado en buscador.js, que no se toca.

import { datos, lineasDeParada } from "./estado.js";
import { esc, insignias, normalizar } from "./ui.js";
import { iconoRuta } from "./iconos-ruta.js";

const MAX_OPCIONES = 8;

/** Texto que se muestra en el campo al elegir una parada. */
export const textoParada = (p) => `${p.nombre} · ${p.id}`;

/**
 * Marcado de un campo. `id` debe ser único en la página.
 * Contiene: etiqueta visible, input combobox, botón «Elegir en el mapa», lista, ayuda y error.
 */
export function htmlSelector({ id, etiqueta, etiquetaMapa, placeholder = "Nombre o número de parada" }) {
    return `
    <div class="campo" id="${id}">
        <label class="campo-etiqueta" for="${id}-entrada">${esc(etiqueta)}</label>
        <div class="campo-control">
            <input id="${id}-entrada" class="campo-entrada" type="text" autocomplete="off" spellcheck="false"
                   placeholder="${esc(placeholder)}" role="combobox" aria-expanded="false" aria-controls="${id}-lista"
                   aria-autocomplete="list" aria-describedby="${id}-ayuda ${id}-error">
            <button type="button" class="boton-icono campo-mapa" data-elegir-mapa aria-pressed="false" aria-label="${esc(etiquetaMapa)}">${iconoRuta("pin", { tam: 20 })}</button>
            <ul id="${id}-lista" class="resultados campo-lista" role="listbox" aria-label="Paradas" hidden></ul>
        </div>
        <p class="campo-ayuda" id="${id}-ayuda" role="status" hidden>Toca una parada en el mapa.</p>
        <p class="campo-error" id="${id}-error" hidden></p>
    </div>`;
}

function puntuar(p, q, esNumero) {
    const nombre = normalizar(p.nombre);
    if (esNumero && String(p.id) === q) return 0;
    if (nombre.startsWith(q)) return 1;
    if (nombre.split(/[\s,.]+/).some((palabra) => palabra.startsWith(q))) return 2;
    if (nombre.includes(q)) return 3;
    if (esNumero && String(p.id).startsWith(q)) return 4;
    return -1;
}

function coincidencias(texto) {
    const q = normalizar(texto.trim());
    if (!q) return [];
    const esNumero = /^\d+$/.test(q);
    return datos.paradas
        .map((p) => ({ p, punt: puntuar(p, q, esNumero) }))
        .filter((x) => x.punt >= 0)
        .sort((a, b) => a.punt - b.punt || a.p.nombre.localeCompare(b.p.nombre, "es"))
        .slice(0, MAX_OPCIONES)
        .map((x) => x.p);
}

/**
 * Activa un campo creado con htmlSelector. Devuelve el control:
 *  id() · fijar(id|null) · resolver() · enfocar() · error(texto|null) · ayuda(bool) · botonMapa
 * Callbacks: alElegir(id) al elegir de la lista; alEnfocar() al recibir el foco; alEditar() al teclear;
 * alPulsarMapa() con el botón «Elegir en el mapa».
 */
export function crearSelector(raiz, { alElegir = () => {}, alEnfocar = () => {}, alEditar = () => {}, alPulsarMapa = () => {} } = {}) {
    const entrada = raiz.querySelector(".campo-entrada");
    const lista = raiz.querySelector(".campo-lista");
    const ayuda = raiz.querySelector(".campo-ayuda");
    const textoError = raiz.querySelector(".campo-error");
    const botonMapa = raiz.querySelector("[data-elegir-mapa]");
    let seleccion = null;
    let opciones = [];
    let activa = -1;

    function abrir() {
        lista.hidden = false;
        entrada.setAttribute("aria-expanded", "true");
    }

    function cerrar() {
        lista.hidden = true;
        entrada.setAttribute("aria-expanded", "false");
        entrada.removeAttribute("aria-activedescendant");
        activa = -1;
    }

    function error(texto) {
        textoError.textContent = texto ?? "";
        textoError.hidden = !texto;
        if (texto) entrada.setAttribute("aria-invalid", "true");
        else entrada.removeAttribute("aria-invalid");
        raiz.classList.toggle("campo-con-error", Boolean(texto));
    }

    function fijar(id) {
        const p = id == null ? null : datos.paradaPorId.get(id);
        seleccion = p ? p.id : null;
        entrada.value = p ? textoParada(p) : "";
        error(null);
        cerrar();
    }

    function buscar() {
        if (!entrada.value.trim()) {
            cerrar();
            return;
        }
        const encontradas = coincidencias(entrada.value);
        opciones = [];
        activa = -1;
        entrada.removeAttribute("aria-activedescendant");
        if (!encontradas.length) {
            lista.innerHTML = '<li class="resultados-estado" role="presentation">Sin resultados. Prueba con el número de la parada.</li>';
            abrir();
            return;
        }
        lista.innerHTML = encontradas.map((p, n) =>
            `<li id="${raiz.id}-op-${n}" role="option" aria-selected="false" data-id="${Number(p.id)}"><span class="res-texto"><span class="res-nombre">${esc(p.nombre)}</span><span class="res-sub">Parada ${Number(p.id)}</span></span><span class="res-insignias">${insignias(lineasDeParada(p), 3)}</span></li>`
        ).join("");
        opciones = [...lista.querySelectorAll('[role="option"]')];
        abrir();
    }

    function activar(i) {
        opciones.forEach((o) => o.setAttribute("aria-selected", "false"));
        if (!opciones.length) return;
        activa = (i + opciones.length) % opciones.length;
        const op = opciones[activa];
        op.setAttribute("aria-selected", "true");
        entrada.setAttribute("aria-activedescendant", op.id);
        op.scrollIntoView({ block: "nearest" });
    }

    function elegir(op) {
        const id = Number(op.dataset.id);
        fijar(id);
        alElegir(id);
    }

    entrada.addEventListener("input", () => {
        seleccion = null;
        error(null);
        alEditar();
        buscar();
    });
    entrada.addEventListener("focus", () => {
        entrada.select();
        alEnfocar();
        if (seleccion == null && entrada.value.trim()) buscar();
    });
    entrada.addEventListener("blur", cerrar);
    entrada.addEventListener("keydown", (e) => {
        const abierta = !lista.hidden;
        switch (e.key) {
            case "ArrowDown":
                e.preventDefault();
                if (!abierta) buscar();
                activar(activa + 1);
                break;
            case "ArrowUp":
                e.preventDefault();
                if (!abierta) buscar();
                activar(activa < 0 ? opciones.length - 1 : activa - 1);
                break;
            case "Enter": {
                const op = opciones[activa] ?? (opciones.length === 1 ? opciones[0] : null);
                if (abierta && op) {
                    e.preventDefault();   // elige la opción; no envía el formulario
                    elegir(op);
                }
                break;
            }
            case "Escape":
                if (abierta) {
                    e.preventDefault();
                    e.stopPropagation();  // cierra la lista; no cancela «elegir en el mapa»
                    cerrar();
                }
                break;
            default:
        }
    });
    // El clic se resuelve antes de que el blur cierre la lista
    lista.addEventListener("mousedown", (e) => e.preventDefault());
    lista.addEventListener("click", (e) => {
        const op = e.target.closest('[role="option"]');
        if (op) elegir(op);
    });
    botonMapa.addEventListener("click", () => alPulsarMapa());

    return {
        botonMapa,
        entrada,
        id: () => seleccion,
        fijar,
        error,
        enfocar: () => entrada.focus(),
        ayuda(visible) {
            ayuda.hidden = !visible;
            botonMapa.setAttribute("aria-pressed", String(visible));
            raiz.classList.toggle("campo-eligiendo", visible);
        },
        /** Id de la parada elegida; si el texto es un número de parada o un nombre único, lo acepta. */
        resolver() {
            if (seleccion != null) return seleccion;
            const q = normalizar(entrada.value.trim());
            if (!q) return null;
            if (/^\d+$/.test(q) && datos.paradaPorId.has(Number(q))) {
                fijar(Number(q));
                return seleccion;
            }
            const exactas = datos.paradas.filter((p) => normalizar(p.nombre) === q || normalizar(textoParada(p)) === q);
            if (exactas.length === 1) {
                fijar(exactas[0].id);
                return seleccion;
            }
            return null;
        },
    };
}
