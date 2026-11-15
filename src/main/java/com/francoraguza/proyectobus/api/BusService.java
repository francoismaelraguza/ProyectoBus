package com.francoraguza.proyectobus.api;

import com.francoraguza.proyectobus.api.ApiDtos.*;
import com.francoraguza.proyectobus.itranvias.ITranviasClient;
import com.francoraguza.proyectobus.itranvias.ITranviasDtos.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalTime;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Traduce los datos crudos de iTranvías a nuestros DTOs y cachea
 * las respuestas para no saturar la API.
 */
@Service
public class BusService {

    private final ITranviasClient client;
    private final Duration ttlCatalogo;
    private final Duration ttlLlegadas;
    private final Duration ttlRecorridos;

    private volatile Cacheado<Catalogo> catalogo;
    private final Map<Integer, Cacheado<LlegadasParada>> llegadas = new ConcurrentHashMap<>();
    private final Map<Integer, Cacheado<RecorridoLinea>> recorridos = new ConcurrentHashMap<>();

    public BusService(ITranviasClient client,
                      @Value("${itranvias.cache.catalogo}") Duration ttlCatalogo,
                      @Value("${itranvias.cache.llegadas}") Duration ttlLlegadas,
                      @Value("${itranvias.cache.recorridos}") Duration ttlRecorridos) {
        this.client = client;
        this.ttlCatalogo = ttlCatalogo;
        this.ttlLlegadas = ttlLlegadas;
        this.ttlRecorridos = ttlRecorridos;
    }

    // ---------------- Catálogo ----------------

    public Catalogo catalogo() {
        Cacheado<Catalogo> c = catalogo;
        if (c != null && c.vigente(ttlCatalogo)) {
            return c.valor();
        }
        synchronized (this) {
            if (catalogo != null && catalogo.vigente(ttlCatalogo)) {
                return catalogo.valor();
            }
            try {
                catalogo = new Cacheado<>(cargarCatalogo(), Instant.now());
            } catch (ResponseStatusException e) {
                // Si falla pero teníamos uno antiguo, mejor eso que nada
                if (catalogo != null) return catalogo.valor();
                throw e;
            }
            return catalogo.valor();
        }
    }

    private Catalogo cargarCatalogo() {
        CatalogoRespuesta r = client.catalogo();
        if (r == null || r.iTranvias() == null || r.iTranvias().actualizacion() == null) {
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "Catálogo con formato inesperado");
        }
        Actualizacion a = r.iTranvias().actualizacion();

        List<Linea> lineas = Optional.ofNullable(a.lineas()).orElse(List.of()).stream()
                .map(l -> new Linea(
                        l.id(),
                        l.linComer(),
                        l.nombreOrig(),
                        l.nombreDest(),
                        "#" + Optional.ofNullable(l.color()).orElse("888888"),
                        Optional.ofNullable(l.rutas()).orElse(List.of()).stream()
                                .map(ru -> Optional.ofNullable(ru.paradas()).orElse(List.of()))
                                .toList()))
                .toList();

        // Las paradas sin líneas ("enlaces" vacío) están fuera de servicio: no las mostramos
        List<Parada> paradas = Optional.ofNullable(a.paradas()).orElse(List.of()).stream()
                .filter(p -> p.enlaces() != null && !p.enlaces().isEmpty())
                .map(p -> new Parada(p.id(), p.nombre(), p.posy(), p.posx(), p.enlaces()))
                .toList();

        return new Catalogo(a.fecha(), lineas, paradas);
    }

    // ---------------- Llegadas ----------------

    public LlegadasParada llegadas(int paradaId) {
        Cacheado<LlegadasParada> c = llegadas.get(paradaId);
        if (c != null && c.vigente(ttlLlegadas)) {
            return c.valor();
        }
        LlegadasParada nuevo = cargarLlegadas(paradaId);
        llegadas.put(paradaId, new Cacheado<>(nuevo, Instant.now()));
        return nuevo;
    }

    private LlegadasParada cargarLlegadas(int paradaId) {
        Catalogo cat = catalogo();
        Map<Integer, Parada> paradas = new HashMap<>();
        cat.paradas().forEach(p -> paradas.put(p.id(), p));
        Map<Integer, Linea> lineas = new HashMap<>();
        cat.lineas().forEach(l -> lineas.putIfAbsent(l.id(), l));

        LlegadasRespuesta r = client.llegadas(paradaId);
        List<LineaLlegadaRaw> raw = (r != null && r.buses() != null && r.buses().lineas() != null)
                ? r.buses().lineas() : List.of();

        // Si una línea aparece repetida en la respuesta, se fusionan sus buses
        Map<Integer, List<BusRaw>> porLinea = new LinkedHashMap<>();
        for (LineaLlegadaRaw ll : raw) {
            porLinea.computeIfAbsent(ll.linea(), k -> new ArrayList<>())
                    .addAll(Optional.ofNullable(ll.buses()).orElse(List.of()));
        }

        List<LineaLlegadas> resultado = new ArrayList<>();
        for (var entrada : porLinea.entrySet()) {
            Linea info = lineas.get(entrada.getKey());
            String nombre = info != null ? info.nombre() : String.valueOf(entrada.getKey());
            String color = info != null ? info.color() : "#888888";

            List<BusLlegada> buses = entrada.getValue().stream()
                    .map(b -> {
                        Parada ult = paradas.get(b.ultParada());
                        return new BusLlegada(
                                b.bus(), entero(b.tiempo()), entero(b.distancia()), b.estado(),
                                b.ultParada(),
                                ult != null ? ult.nombre() : null,
                                ult != null ? ult.lat() : null,
                                ult != null ? ult.lng() : null);
                    })
                    .sorted(Comparator.comparing(BusLlegada::minutos, Comparator.nullsLast(Comparator.naturalOrder())))
                    .toList();

            resultado.add(new LineaLlegadas(entrada.getKey(), nombre, color, buses));
        }
        // Primero la línea cuyo próximo bus llega antes
        resultado.sort(Comparator.comparingInt(l -> l.buses().isEmpty() || l.buses().getFirst().minutos() == null
                ? Integer.MAX_VALUE : l.buses().getFirst().minutos()));

        Parada p = paradas.get(paradaId);
        String consultado = LocalTime.now().format(DateTimeFormatter.ofPattern("HH:mm:ss"));
        return new LlegadasParada(paradaId, p != null ? p.nombre() : "Parada " + paradaId, consultado, resultado);
    }

    // ---------------- Recorrido ----------------

    public RecorridoLinea recorrido(int lineaId) {
        Linea linea = catalogo().lineas().stream().filter(l -> l.id() == lineaId).findFirst()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Línea desconocida: " + lineaId));

        Cacheado<RecorridoLinea> c = recorridos.get(lineaId);
        if (c != null && c.vigente(ttlRecorridos)) {
            return c.valor();
        }
        try {
            RecorridoLinea nuevo = cargarRecorrido(linea);
            recorridos.put(lineaId, new Cacheado<>(nuevo, Instant.now()));
            return nuevo;
        } catch (ResponseStatusException e) {
            // Si iTranvías falla pero hay copia antigua, mejor eso que nada
            if (c != null) return c.valor();
            throw e;
        }
    }

    private RecorridoLinea cargarRecorrido(Linea linea) {
        Map<Integer, Parada> paradasCat = new HashMap<>();
        catalogo().paradas().forEach(p -> paradasCat.put(p.id(), p));

        MapaRespuesta r = client.mapaLinea(linea.id(), "PR");
        Map<Integer, List<ParadaRecorrido>> paradasPorSentido = new TreeMap<>();
        Map<Integer, List<double[]>> trazadoPorSentido = new TreeMap<>();

        if (r != null && r.mapas() != null) {
            for (MapaBloque bloque : r.mapas()) {
                if (bloque == null) continue;
                if (bloque.recorridos() != null) {
                    for (SentidoRecorridoRaw sr : bloque.recorridos()) {
                        Integer s = entero(sr.sentido());
                        List<double[]> t = parsearTrazado(sr.recorrido());
                        if (s != null && t.size() >= 2) trazadoPorSentido.put(s, t);
                    }
                }
                if (bloque.paradas() != null) {
                    for (SentidoParadasRaw sp : bloque.paradas()) {
                        Integer s = entero(sp.sentido());
                        if (s == null || sp.paradas() == null) continue;
                        List<ParadaRecorrido> lista = new ArrayList<>();
                        for (ParadaMapaRaw p : sp.paradas()) {
                            Integer id = entero(p.id());
                            if (id != null) lista.add(new ParadaRecorrido(id, p.parada(), p.posy(), p.posx()));
                        }
                        paradasPorSentido.put(s, lista);
                    }
                }
            }
        }

        List<SentidoRecorrido> sentidos = new ArrayList<>();
        // Solo los sentidos con recorrido: descarta residuales como "30"
        for (var e : trazadoPorSentido.entrySet()) {
            List<ParadaRecorrido> ps = paradasPorSentido.getOrDefault(e.getKey(), List.of());
            if (ps.isEmpty()) continue;
            sentidos.add(new SentidoRecorrido(e.getKey(), ps.getLast().nombre(), ps, e.getValue()));
        }

        if (sentidos.isEmpty()) {
            // Sin recorridos en la respuesta: se construye con las rutas del catálogo
            List<List<Integer>> rutas = linea.rutas().stream().limit(2).toList();
            for (int i = 0; i < rutas.size(); i++) {
                List<ParadaRecorrido> ps = new ArrayList<>();
                for (int id : rutas.get(i)) {
                    Parada p = paradasCat.get(id);
                    if (p != null) ps.add(new ParadaRecorrido(p.id(), p.nombre(), p.lat(), p.lng()));
                }
                if (ps.size() < 2) continue;
                List<double[]> t = ps.stream()
                        .map(p -> new double[]{redondear(p.lat()), redondear(p.lng())})
                        .toList();
                sentidos.add(new SentidoRecorrido(i, ps.getLast().nombre(), ps, t));
            }
        }
        if (sentidos.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "iTranvías no devolvió recorrido para la línea");
        }
        return new RecorridoLinea(linea.id(), linea.nombre(), linea.color(), sentidos);
    }

    private static List<double[]> parsearTrazado(String texto) {
        List<double[]> puntos = new ArrayList<>();
        if (texto == null || texto.isBlank()) return puntos;
        for (String punto : texto.trim().split("\\s+")) {
            String[] partes = punto.split(",");
            if (partes.length < 2) continue;
            try {
                double lng = Double.parseDouble(partes[0]);
                double lat = Double.parseDouble(partes[1]);
                puntos.add(new double[]{redondear(lat), redondear(lng)});
            } catch (NumberFormatException ignorado) {
                // punto mal formado: se salta
            }
        }
        return puntos;
    }

    private static double redondear(double v) {
        return Math.round(v * 1_000_000d) / 1_000_000d;
    }

    /** Número tolerante: "--" o vacío = null; "<1" = 0. */
    private static Integer entero(String s) {
        try {
            if (s == null || s.isBlank()) return null;
            if (s.trim().startsWith("<")) return 0;
            return Integer.valueOf(s.trim());
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private record Cacheado<T>(T valor, Instant cuando) {
        boolean vigente(Duration ttl) {
            return cuando.plus(ttl).isAfter(Instant.now());
        }
    }
}
