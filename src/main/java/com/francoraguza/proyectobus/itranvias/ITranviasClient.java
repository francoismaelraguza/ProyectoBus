package com.francoraguza.proyectobus.itranvias;

import com.francoraguza.proyectobus.itranvias.ITranviasDtos.CatalogoRespuesta;
import com.francoraguza.proyectobus.itranvias.ITranviasDtos.LlegadasRespuesta;
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

    private final RestClient http;
    private final JsonMapper json;

    public ITranviasClient(@Value("${itranvias.base-url}") String baseUrl, JsonMapper json) {
        this.json = json;
        this.http = RestClient.builder()
                .baseUrl(baseUrl)
                .defaultHeader(HttpHeaders.USER_AGENT,
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36")
                .defaultHeader(HttpHeaders.REFERER, "https://itranvias.com/")
                .build();
    }

    public CatalogoRespuesta catalogo() {
        return parsear(get("func", "7", CATALOGO_DATO), CatalogoRespuesta.class);
    }

    public LlegadasRespuesta llegadas(int paradaId) {
        return parsear(get("func", "0", String.valueOf(paradaId)), LlegadasRespuesta.class);
    }

    private <T> T parsear(String body, Class<T> tipo) {
        try {
            return json.readValue(body, tipo);
        } catch (Exception e) {
            log.warn("Respuesta de iTranvías con formato inesperado: {}", e.getMessage());
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "Formato inesperado de iTranvías", e);
        }
    }

    private String get(String funcParam, String func, String dato) {
        try {
            String body = http.get()
                    .uri(uri -> uri.path("/queryitr_v3.php")
                            .queryParam(funcParam, func)
                            .queryParam("dato", dato)
                            .build())
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
