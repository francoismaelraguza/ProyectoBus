// ProyectoBus — mapa en tiempo real de los buses de A Coruña
// Datos: nuestro backend (/api), que a su vez consulta iTranvías.

const REFRESCO_MS = 20_000;
const CORUNA = [43.3623, -8.4115];

const estado = {
    paradas: new Map(),      // id -> parada
    lineas: new Map(),       // id interno -> línea
    lineaActiva: null,       // nombre comercial ("14") o null
    paradaAbierta: null,     // id de parada
    temporizador: null,
};

// ---------- Mapa ----------
const mapa = L.map("mapa", { zoomControl: false, attributionControl: true })
    .setView(CORUNA, 14);

// Mapa base: CARTO Voyager (raster). La clave es pública: va en cada petición del navegador.
const CARTO_KEY = "cb1_4zpy_1_06146c6b2dad313543d4c4cf";

L.tileLayer(`https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png?key=${CARTO_KEY}`, {
    maxZoom: 20,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a> · Datos: iTranvías (no oficial)',
}).addTo(mapa);

L.control.zoom({ position: "bottomleft" }).addTo(mapa);

const capaRutas = L.layerGroup().addTo(mapa);
const capaParadas = L.layerGroup().addTo(mapa);
const capaBuses = L.layerGroup().addTo(mapa);
const marcadoresParada = new Map(); // id -> circleMarker

// ---------- Utilidades ----------
const $ = (sel) => document.querySelector(sel);

const normalizar = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function aviso(texto) {
    const el = $("#aviso");
    el.textContent = texto;
    el.hidden = false;
    clearTimeout(aviso.t);
    aviso.t = setTimeout(() => (el.hidden = true), 4000);
}

async function getJson(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
}

function escapar(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
}

function nombresLineas(ids) {
    const nombres = ids.map((id) => estado.lineas.get(id)?.nombre).filter(Boolean);
    return [...new Set(nombres)];
}

// ---------- Favoritos (localStorage, con try/catch por si está bloqueado) ----------
function leerFavs() {
    try { return JSON.parse(localStorage.getItem("favs") || "[]"); } catch { return []; }
}
function guardarFavs(favs) {
    try { localStorage.setItem("favs", JSON.stringify(favs)); } catch { /* sin almacenamiento */ }
}
function esFav(id) { return leerFavs().includes(id); }
function alternarFav(id) {
    const favs = leerFavs();
    guardarFavs(favs.includes(id) ? favs.filter((f) => f !== id) : [...favs, id]);
    pintarBotonFav();
}
function pintarBotonFav() {
    const btn = $("#btn-fav");
    const fav = esFav(estado.paradaAbierta);
    btn.textContent = fav ? "★" : "☆";
    btn.classList.toggle("fav", fav);
}

// ---------- Catálogo ----------
async function cargarCatalogo() {
    const cat = await getJson("/api/catalogo");
    cat.lineas.forEach((l) => estado.lineas.set(l.id, l));
    cat.paradas.forEach((p) => estado.paradas.set(p.id, p));
    pintarChips();
    pintarParadas();
}

function pintarChips() {
    // BUH y UDC tienen varias variantes con el mismo nombre: un chip por nombre
    const porNombre = new Map();
    for (const l of estado.lineas.values()) {
        if (!porNombre.has(l.nombre)) porNombre.set(l.nombre, l.color);
    }
    const chips = $("#chips");
    chips.innerHTML = "";
    for (const [nombre, color] of porNombre) {
        const b = document.createElement("button");
        b.className = "chip";
        b.textContent = nombre;
        b.style.setProperty("--color", color);
        b.onclick = () => seleccionarLinea(estado.lineaActiva === nombre ? null : nombre);
        chips.append(b);
    }
}

function pintarParadas() {
    capaParadas.clearLayers();
    marcadoresParada.clear();

    const activa = estado.lineaActiva;
    const idsActiva = activa
        ? [...estado.lineas.values()].filter((l) => l.nombre === activa).map((l) => l.id)
        : null;
    const color = idsActiva ? estado.lineas.get(idsActiva[0]).color : "#9aa3b2";

    for (const p of estado.paradas.values()) {
        if (idsActiva && !p.lineas.some((id) => idsActiva.includes(id))) continue;

        const m = L.circleMarker([p.lat, p.lng], {
            radius: idsActiva ? 6 : 5,
            color: "#14171d",
            weight: 2,
            fillColor: color,
            fillOpacity: 0.95,
        });
        m.bindTooltip(`${escapar(p.nombre)}<br><small>${nombresLineas(p.lineas).join(" · ")}</small>`, {
            direction: "top",
            offset: [0, -6],
        });
        m.on("click", () => abrirParada(p.id));
        m.addTo(capaParadas);
        marcadoresParada.set(p.id, m);
    }
    resaltarParada();
}

function seleccionarLinea(nombre) {
    estado.lineaActiva = nombre;
    document.querySelectorAll(".chip").forEach((c) =>
        c.classList.toggle("activo", c.textContent === nombre));

    capaRutas.clearLayers();
    if (nombre) {
        const variantes = [...estado.lineas.values()].filter((l) => l.nombre === nombre);
        const puntos = [];
        for (const l of variantes) {
            for (const ruta of l.rutas) {
                const coords = ruta.map((id) => estado.paradas.get(id))
                    .filter(Boolean)
                    .map((p) => [p.lat, p.lng]);
                if (coords.length > 1) {
                    L.polyline(coords, { color: l.color, weight: 4, opacity: 0.8 }).addTo(capaRutas);
                    puntos.push(...coords);
                }
            }
        }
        if (puntos.length) mapa.fitBounds(puntos, { padding: [40, 40] });
    }
    pintarParadas();
}

function resaltarParada() {
    for (const [id, m] of marcadoresParada) {
        const abierta = id === estado.paradaAbierta;
        m.setStyle({ color: abierta ? "#ffffff" : "#14171d", weight: abierta ? 3 : 2 });
        m.setRadius(abierta ? 9 : (estado.lineaActiva ? 6 : 5));
        if (abierta) m.bringToFront();
    }
}

// ---------- Llegadas a una parada ----------
async function abrirParada(id, { centrar = false } = {}) {
    const p = estado.paradas.get(id);
    if (!p) return;

    estado.paradaAbierta = id;
    history.replaceState(null, "", `?parada=${id}`);
    $("#panel").hidden = false;
    $("#panel-titulo").textContent = p.nombre;
    $("#panel-sub").textContent = `Parada ${id} · Líneas ${nombresLineas(p.lineas).join(", ")}`;
    $("#panel-cuerpo").innerHTML = `<div class="cargando">Consultando buses…</div>`;
    pintarBotonFav();
    resaltarParada();
    if (centrar) mapa.setView([p.lat, p.lng], 16);

    clearInterval(estado.temporizador);
    await refrescarLlegadas();
    estado.temporizador = setInterval(refrescarLlegadas, REFRESCO_MS);
}

async function refrescarLlegadas() {
    const id = estado.paradaAbierta;
    if (id == null) return;
    try {
        const datos = await getJson(`/api/paradas/${id}/llegadas`);
        if (estado.paradaAbierta !== id) return; // el usuario cambió de parada mientras tanto
        pintarLlegadas(datos);
        pintarBuses(datos);
    } catch (e) {
        aviso("No se pudo consultar iTranvías. Reintentando…");
    }
}

function textoTiempo(bus) {
    if (bus.distancia === 0 || bus.minutos === 0) return "En parada";
    return `${bus.minutos} min`;
}

function pintarLlegadas(datos) {
    $("#panel-sub").textContent = `Parada ${datos.parada} · Actualizado ${datos.consultado}`;
    const cuerpo = $("#panel-cuerpo");

    if (!datos.lineas.length) {
        cuerpo.innerHTML = `<div class="vacio">Ahora mismo no hay buses de camino a esta parada.</div>`;
        return;
    }

    cuerpo.innerHTML = datos.lineas.map((l) => `
        <article class="linea" style="--color:${escapar(l.color)}">
            <h3>Línea ${escapar(l.nombre)} <small>${l.buses.length} bus${l.buses.length === 1 ? "" : "es"}</small></h3>
            ${l.buses.map((b) => `
                <div class="bus" data-lat="${b.lat ?? ""}" data-lng="${b.lng ?? ""}">
                    <span class="bus-num">🚌 ${b.bus}</span>
                    <span class="bus-dist">📍 ${b.distancia.toLocaleString("es-ES")} m</span>
                    <span class="bus-tiempo ${textoTiempo(b) === "En parada" ? "ya" : ""}">${textoTiempo(b)}</span>
                    ${b.ultParadaNombre ? `<span class="bus-donde">🏢 ${escapar(b.ultParadaNombre)}</span>` : ""}
                </div>`).join("")}
        </article>`).join("");

    cuerpo.querySelectorAll(".bus").forEach((el) => {
        el.onclick = () => {
            const { lat, lng } = el.dataset;
            if (lat && lng) mapa.flyTo([+lat, +lng], 16, { duration: 0.6 });
        };
    });
}

// Coloca cada bus sobre la última parada por la que pasó.
// Si varios coinciden en la misma parada, se separan un poco para que se vean todos.
function pintarBuses(datos) {
    capaBuses.clearLayers();
    const ocupados = new Map();

    for (const l of datos.lineas) {
        for (const b of l.buses) {
            if (b.lat == null || b.lng == null) continue;
            const clave = `${b.lat},${b.lng}`;
            const n = ocupados.get(clave) ?? 0;
            ocupados.set(clave, n + 1);

            const icono = L.divIcon({
                className: "",
                html: `<div class="bus-marcador" style="--color:${escapar(l.color)}">${escapar(l.nombre)}</div>`,
                iconSize: [40, 26],
                iconAnchor: [20, 13 + n * 28],
            });
            L.marker([b.lat, b.lng], { icon: icono, zIndexOffset: 1000 })
                .bindTooltip(`Línea ${escapar(l.nombre)} · bus ${b.bus}<br>${textoTiempo(b)} · ${b.distancia} m`)
                .addTo(capaBuses);
        }
    }
}

function cerrarPanel() {
    clearInterval(estado.temporizador);
    estado.paradaAbierta = null;
    capaBuses.clearLayers();
    $("#panel").hidden = true;
    history.replaceState(null, "", location.pathname);
    resaltarParada();
}

// ---------- Buscador ----------
function configurarBuscador() {
    const input = $("#buscar");
    const lista = $("#resultados");

    input.addEventListener("input", () => {
        const q = normalizar(input.value.trim());
        if (q.length < 2) { lista.hidden = true; return; }

        const encontradas = [...estado.paradas.values()]
            .filter((p) => normalizar(p.nombre).includes(q) || String(p.id) === q)
            .slice(0, 12);

        lista.innerHTML = encontradas.length
            ? encontradas.map((p) =>
                `<li tabindex="0" data-id="${p.id}">${escapar(p.nombre)}<small>${nombresLineas(p.lineas).join(" · ")}</small></li>`).join("")
            : `<li>Sin resultados</li>`;
        lista.hidden = false;
    });

    lista.addEventListener("click", (e) => {
        const li = e.target.closest("li[data-id]");
        if (!li) return;
        abrirParada(+li.dataset.id, { centrar: true });
        lista.hidden = true;
        input.value = "";
        input.blur();
    });

    document.addEventListener("click", (e) => {
        if (!e.target.closest(".buscador")) lista.hidden = true;
    });
}

// ---------- Arranque ----------
$("#btn-cerrar").onclick = cerrarPanel;
$("#btn-fav").onclick = () => alternarFav(estado.paradaAbierta);
configurarBuscador();

(async () => {
    try {
        await cargarCatalogo();
    } catch (e) {
        aviso("No se pudo cargar el catálogo de iTranvías.");
        return;
    }
    const desdeUrl = Number(new URLSearchParams(location.search).get("parada"));
    const inicial = desdeUrl || leerFavs()[0];
    if (inicial && estado.paradas.has(inicial)) abrirParada(inicial, { centrar: true });
})();
