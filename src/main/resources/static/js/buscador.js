// Buscador de paradas y líneas con patrón combobox ARIA.

import { datos, lineasDeParada } from "./estado.js";
import { esc, insignia, insignias, normalizar } from "./ui.js";

const MAX_PARADAS = 8;
const MAX_LINEAS = 4;

let entrada;
let lista;
let estadoVacio;
let alElegir = () => {};
let alEnfocar = () => {};
let opciones = [];   // elementos <li role="option"> navegables
let activa = -1;

export function iniciar({ input, resultados, estado, alElegir: elegir, alEnfocar: enfocar }) {
    entrada = input;
    lista = resultados;
    estadoVacio = estado;
    alElegir = elegir ?? alElegir;
    alEnfocar = enfocar ?? alEnfocar;

    entrada.addEventListener("input", buscar);
    entrada.addEventListener("focus", () => {
        alEnfocar();
        if (entrada.value.trim()) buscar();
    });
    entrada.addEventListener("keydown", teclado);
    // El clic se resuelve antes de que el blur cierre la lista
    lista.addEventListener("mousedown", (e) => e.preventDefault());
    lista.addEventListener("click", (e) => {
        const enlace = e.target.closest("a[href]");
        if (enlace) cerrar();
    });
    document.addEventListener("click", (e) => {
        if (!e.target.closest(".buscador")) cerrar();
    });
}

function puntuarParada(p, q, esNumero) {
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
    const esNumero = /^\d+$/.test(q);

    const paradas = datos.paradas
        .map((p) => ({ p, punt: puntuarParada(p, q, esNumero) }))
        .filter((x) => x.punt >= 0)
        .sort((a, b) => a.punt - b.punt || a.p.nombre.localeCompare(b.p.nombre, "es"))
        .slice(0, MAX_PARADAS)
        .map((x) => x.p);

    const lineas = datos.lineas
        .filter((l) => normalizar(l.nombre) === q ||
            normalizar(l.nombre).startsWith(q) ||
            (q.length >= 3 && normalizar(`${l.origen} ${l.destino}`).includes(q)))
        .slice(0, MAX_LINEAS);

    return { paradas, lineas };
}

function buscar() {
    const texto = entrada.value;
    if (!texto.trim()) {
        cerrar();
        return;
    }
    const { paradas, lineas } = coincidencias(texto);
    let n = 0;
    let html = "";

    if (paradas.length) {
        html += '<li class="resultados-grupo" role="presentation">Paradas</li>';
        html += paradas.map((p) => {
            const l = lineasDeParada(p);
            return `<li id="op-${n++}" role="option" aria-selected="false"><a href="?parada=${p.id}" tabindex="-1"><span class="res-texto"><span class="res-nombre">${esc(p.nombre)}</span><span class="res-sub">Parada ${p.id}</span></span><span class="res-insignias">${insignias(l, 3)}</span></a></li>`;
        }).join("");
    }
    if (lineas.length) {
        html += '<li class="resultados-grupo" role="presentation">Líneas</li>';
        html += lineas.map((l) =>
            `<li id="op-${n++}" role="option" aria-selected="false"><a href="?linea=${l.id}" tabindex="-1">${insignia(l)}<span class="res-texto"><span class="res-nombre">${esc(l.origen)} – ${esc(l.destino)}</span></span></a></li>`
        ).join("");
    }
    if (!n) {
        lista.innerHTML = "";
        opciones = [];
        cerrar();
        estadoVacio.textContent = `Sin resultados para “${texto.trim()}”. Prueba con el número de la parada.`;
        return;
    }
    estadoVacio.textContent = "";
    lista.innerHTML = html;
    opciones = [...lista.querySelectorAll('[role="option"]')];
    activa = -1;
    abrir();
}

function abrir() {
    lista.hidden = false;
    entrada.setAttribute("aria-expanded", "true");
}

function cerrar() {
    estadoVacio.textContent = "";
    lista.hidden = true;
    entrada.setAttribute("aria-expanded", "false");
    entrada.removeAttribute("aria-activedescendant");
    activa = -1;
}

function activar(i) {
    opciones.forEach((o) => o.setAttribute("aria-selected", "false"));
    if (i < 0 || !opciones.length) {
        activa = -1;
        entrada.removeAttribute("aria-activedescendant");
        return;
    }
    activa = (i + opciones.length) % opciones.length;
    const op = opciones[activa];
    op.setAttribute("aria-selected", "true");
    entrada.setAttribute("aria-activedescendant", op.id);
    op.scrollIntoView({ block: "nearest" });
}

function teclado(e) {
    const abierta = !lista.hidden;
    switch (e.key) {
        case "ArrowDown":
            e.preventDefault();
            if (!abierta && entrada.value.trim()) buscar();
            activar(activa + 1);
            break;
        case "ArrowUp":
            e.preventDefault();
            activar(activa < 0 ? opciones.length - 1 : activa - 1);
            break;
        case "Enter": {
            const op = opciones[activa] ?? (opciones.length === 1 ? opciones[0] : null);
            if (abierta && op) {
                e.preventDefault();
                const href = op.querySelector("a").getAttribute("href");
                cerrar();
                entrada.value = "";
                entrada.blur();
                alElegir(href);
            }
            break;
        }
        case "Escape":
            if (abierta) {
                e.preventDefault();
                cerrar();
            } else if (entrada.value) {
                entrada.value = "";
            }
            break;
        default:
    }
}
