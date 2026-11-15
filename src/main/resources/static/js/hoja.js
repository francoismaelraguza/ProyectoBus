// Hoja inferior del panel en móvil: tres alturas, se mueve solo con transform.

const ESTADOS = ["min", "medio", "max"];
const ALTURA_MIN = 150;
const MARGEN_SUPERIOR = 56;
const consultaMovil = window.matchMedia("(max-width: 899.98px)");

let panel;
let asa;
let estado = "medio";
let arrastre = null;
let suprimirClic = false;
const oyentes = new Set();

const esMovil = () => consultaMovil.matches;

function alturaMaxima() {
    return window.innerHeight - MARGEN_SUPERIOR;
}

function alturaDe(nombre) {
    if (nombre === "min") return ALTURA_MIN;
    if (nombre === "medio") return window.innerHeight * 0.58;
    return alturaMaxima();
}

export function iniciar(elementoPanel, elementoAsa) {
    panel = elementoPanel;
    asa = elementoAsa;

    asa.addEventListener("click", () => {
        if (suprimirClic) {
            suprimirClic = false;
            return;
        }
        fijar(ESTADOS[(ESTADOS.indexOf(estado) + 1) % ESTADOS.length]);
    });
    asa.addEventListener("pointerdown", empezarArrastre);
    asa.addEventListener("pointermove", moverArrastre);
    asa.addEventListener("pointerup", terminarArrastre);
    asa.addEventListener("pointercancel", cancelarArrastre);

    consultaMovil.addEventListener("change", () => fijar(estado));
    window.addEventListener("resize", () => notificar());
    fijar(estado);
}

export function obtenerEstado() {
    return estado;
}

export function fijar(nuevo) {
    estado = nuevo;
    panel.style.transform = "";
    panel.dataset.estado = nuevo;
    asa.setAttribute("aria-expanded", String(nuevo !== "min"));
    notificar();
}

/** Sube la hoja a `minimo` si está más baja. No hace nada en escritorio. */
export function subirAlMenosA(minimo = "medio") {
    if (!esMovil()) return;
    if (ESTADOS.indexOf(estado) < ESTADOS.indexOf(minimo)) fijar(minimo);
}

/** Baja la hoja a `maximo` si está más alta (para dejar ver el mapa). */
export function bajarComoMuchoA(maximo = "medio") {
    if (!esMovil()) return;
    if (ESTADOS.indexOf(estado) > ESTADOS.indexOf(maximo)) fijar(maximo);
}

/** Píxeles del mapa tapados por la hoja (0 en escritorio). */
export function alturaTapada() {
    if (!esMovil()) return 0;
    const visible = arrastre?.visible ?? alturaDe(estado);
    return Math.round(Math.min(visible, window.innerHeight * 0.55));
}

/** Avisa cuando cambia la altura tapada. */
export function alCambiar(fn) {
    oyentes.add(fn);
}

function notificar() {
    const tapada = alturaTapada();
    document.documentElement.style.setProperty("--hoja-alto", `${tapada}px`);
    oyentes.forEach((fn) => fn(tapada));
}

function empezarArrastre(e) {
    if (!esMovil() || (e.pointerType === "mouse" && e.button !== 0)) return;
    asa.setPointerCapture(e.pointerId);
    arrastre = { alto: panel.offsetHeight, y0: e.clientY, visible0: alturaDe(estado), visible: alturaDe(estado), movido: false };
    panel.classList.add("arrastrando");
}

function moverArrastre(e) {
    if (!arrastre) return;
    const dy = e.clientY - arrastre.y0;
    if (Math.abs(dy) > 4) arrastre.movido = true;
    const visible = Math.min(alturaMaxima(), Math.max(ALTURA_MIN, arrastre.visible0 - dy));
    arrastre.visible = visible;
    panel.style.transform = `translateY(${arrastre.alto - visible}px)`;
}

function terminarArrastre() {
    if (!arrastre) return;
    const { visible, movido } = arrastre;
    arrastre = null;
    panel.classList.remove("arrastrando");
    if (!movido) return;
    suprimirClic = true;
    setTimeout(() => { suprimirClic = false; }, 0);
    const masCercano = ESTADOS.reduce((mejor, n) =>
        Math.abs(alturaDe(n) - visible) < Math.abs(alturaDe(mejor) - visible) ? n : mejor);
    fijar(masCercano);
}

function cancelarArrastre() {
    if (!arrastre) return;
    arrastre = null;
    panel.classList.remove("arrastrando");
    fijar(estado);
}
