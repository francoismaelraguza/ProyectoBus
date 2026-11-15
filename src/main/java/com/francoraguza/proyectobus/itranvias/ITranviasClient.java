package com.francoraguza.proyectobus.itranvias;

import com.francoraguza.proyectobus.itranvias.ITranviasDtos.CatalogoRespuesta;
import com.francoraguza.proyectobus.itranvias.ITranviasDtos.LlegadasRespuesta;
import com.francoraguza.proyectobus.itranvias.ITranviasDtos.MapaRespuesta;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.json.JsonMapper;

/**
 * Cliente HTTP de la API no oficial que usa la app iTranvías.
 * Se lee la respuesta como texto y se parsea a mano porque el servidor
 * no siempre devuelve Content-Type: application/json.
 */
@Component
public class ITranviasClient {

    private static final Logger log = LoggerFactory.getLogger(ITranviasClient.class);
    private static final String CATALOGO_DATO = "20160101T000000_gl_0_20160101T000000";

    private static final long HUECO_MS = 200;

    private final Object candado = new Object();
    private long ultimaLlamada = 0;
    private final RestClient http;
    private final JsonMapper json;

    public ITranviasClient(@Value("${itranvias.base-url}") String baseUrl,
                           @Value("${itranvias.user-agent}") String userAgent,
                           JsonMapper json) {
        this.json = json;
        this.http = RestClient.builder()
                .baseUrl(baseUrl)
                .defaultHeader(HttpHeaders.USER_AGENT, userAgent)
                .build();
    }

    public CatalogoRespuesta catalogo() {
        return parsear(get("7", CATALOGO_DATO, null), CatalogoRespuesta.class);
    }

    public LlegadasRespuesta llegadas(int paradaId) {
        return parsear(get("0", String.valueOf(paradaId), null), LlegadasRespuesta.class);
    }

    /** func=99: paradas por sentido y geometria del recorrido. mostrar: "PR" (paradas+recorridos), "PRB" (+buses). */
    public MapaRespuesta mapaLinea(int linea, String mostrar) {
        var cruda = parsear(get("99", String.valueOf(linea), mostrar), ITranviasDtos.MapaRespuestaCruda.class);
        java.util.List<ITranviasDtos.MapaBloque> bloques = new java.util.ArrayList<>();
        if (cruda.mapas() != null) {
            for (var nodo : cruda.mapas()) {
                // Se ignora todo lo que no sea un objeto (p. ej. "mapas":[[]])
                if (nodo == null || !nodo.isObject()) continue;
                try {
                    bloques.add(json.treeToValue(nodo, ITranviasDtos.MapaBloque.class));
                } catch (Exception e) {
                    log.warn("Bloque de mapa ignorado: {}", e.getMessage());
                }
            }
        }
        return new MapaRespuesta(cruda.resultado(), bloques);
    }

    /** func=2: buses de la línea por sentido, con su última parada, estado y avance (0-1). */
    public ITranviasDtos.BusesLineaRespuesta busesLinea(int linea) {
        var cruda = parsear(get("2", String.valueOf(linea), null), ITranviasDtos.BusesLineaCruda.class);
        java.util.List<ITranviasDtos.SentidoBusesRaw> sentidos = new java.util.ArrayList<>();
        if (cruda.paradas() != null) {
            for (var nodo : cruda.paradas()) {
                if (nodo == null || !nodo.isObject()) continue;
                try {
                    sentidos.add(json.treeToValue(nodo, ITranviasDtos.SentidoBusesRaw.class));
                } catch (Exception e) {
                    log.warn("Sentido de buses ignorado: {}", e.getMessage());
                }
            }
        }
        return new ITranviasDtos.BusesLineaRespuesta(sentidos);
    }

    private <T> T parsear(String body, Class<T> tipo) {
        try {
            return json.readValue(body, tipo);
        } catch (Exception e) {
            log.warn("Respuesta de iTranvías con formato inesperado: {}", e.getMessage());
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "Formato inesperado de iTranvías", e);
        }
    }

    /** iTranvías responde 429 si se le llama muy seguido: hueco mínimo entre llamadas salientes. */
    private void esperarTurno() {
        synchronized (candado) {
            long espera = ultimaLlamada + HUECO_MS - System.currentTimeMillis();
            if (espera > 0) {
                try {
                    Thread.sleep(espera);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
            }
            ultimaLlamada = System.currentTimeMillis();
        }
    }

    private String get(String func, String dato, String mostrar) {
        esperarTurno();
        try {
            String body = http.get()
                    .uri(uri -> {
                        var b = uri.path("/queryitr_v3.php").queryParam("func", func);
                        if (mostrar != null) b = b.queryParam("mostrar", mostrar);
                        return b.queryParam("dato", dato).build();
                    })
                    .retrieve()
                    .body(String.class);
            if (body == null || body.isBlank()) {
                throw new IllegalStateException("Respuesta vacía");
            }
            return body;
        } catch (Exception e) {
            log.warn("Fallo llamando a iTranvías (func={}, dato={}): {}", func, dato, e.getMessage());
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "iTranvías no responde", e);
        }
    }
}
