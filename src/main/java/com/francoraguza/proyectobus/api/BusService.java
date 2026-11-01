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

    private volatile Cacheado<Catalogo> catalogo;
    private final Map<Integer, Cacheado<LlegadasParada>> llegadas = new ConcurrentHashMap<>();

    public BusService(ITranviasClient client,
                      @Value("${itranvias.cache.catalogo}") Duration ttlCatalogo,
                      @Value("${itranvias.cache.llegadas}") Duration ttlLlegadas) {
        this.client = client;
        this.ttlCatalogo = ttlCatalogo;
        this.ttlLlegadas = ttlLlegadas;
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

        List<LineaLlegadas> resultado = new ArrayList<>();
        for (LineaLlegadaRaw ll : raw) {
            Linea info = lineas.get(ll.linea());
            String nombre = info != null ? info.nombre() : String.valueOf(ll.linea());
            String color = info != null ? info.color() : "#888888";

            List<BusLlegada> buses = Optional.ofNullable(ll.buses()).orElse(List.of()).stream()
                    .map(b -> {
                        Parada ult = paradas.get(b.ultParada());
                        return new BusLlegada(
                                b.bus(), b.tiempo(), b.distancia(), b.estado(),
                                b.ultParada(),
                                ult != null ? ult.nombre() : null,
                                ult != null ? ult.lat() : null,
                                ult != null ? ult.lng() : null);
                    })
                    .sorted(Comparator.comparingInt(BusLlegada::minutos))
                    .toList();

            resultado.add(new LineaLlegadas(ll.linea(), nombre, color, buses));
        }
        // Primero la línea cuyo próximo bus llega antes
        resultado.sort(Comparator.comparingInt(l -> l.buses().isEmpty() ? Integer.MAX_VALUE : l.buses().getFirst().minutos()));

        Parada p = paradas.get(paradaId);
        String consultado = LocalTime.now().format(DateTimeFormatter.ofPattern("HH:mm:ss"));
        return new LlegadasParada(paradaId, p != null ? p.nombre() : "Parada " + paradaId, consultado, resultado);
    }

    private record Cacheado<T>(T valor, Instant cuando) {
        boolean vigente(Duration ttl) {
            return cuando.plus(ttl).isAfter(Instant.now());
        }
    }
}
