package com.francoraguza.proyectobus.api;

import com.francoraguza.proyectobus.api.ApiDtos.*;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;

import java.util.ArrayList;
import java.util.List;
import java.util.function.IntFunction;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Catálogo sintético. Las paradas "de la calle" están separadas 0,005° de latitud (~555 m),
 * así que no se pueden unir andando (el límite es 350 m).
 */
class PlanificadorServiceTest {

    private static final double LAT0 = 43.35;
    private static final double LNG0 = -8.40;
    private static final double PASO = 0.005;   // ~555 m

    private static Parada parada(int id, double lat, double lng) {
        return new Parada(id, "Parada " + id, lat, lng, List.of());
    }

    /** Parada en la "calle" n (0, 1, 2…): se separan en latitud. */
    private static Parada calle(int id, int n) {
        return parada(id, LAT0 + n * PASO, LNG0);
    }

    private static Linea linea(int id, String nombre, Integer... paradas) {
        return new Linea(id, nombre, "Origen", "Destino", "#0055AA", List.of(List.of(paradas)));
    }

    private static PlanificadorService servicio(List<Parada> paradas, List<Linea> lineas) {
        return servicio(paradas, lineas, id -> null);
    }

    private static PlanificadorService servicio(List<Parada> paradas, List<Linea> lineas,
                                                IntFunction<LlegadasParada> llegadas) {
        Catalogo cat = new Catalogo("test", lineas, paradas);
        return new PlanificadorService(() -> cat, llegadas, id -> {
            throw new IllegalStateException("sin red");
        });
    }

    private static List<Tramo> buses(Itinerario it) {
        return it.tramos().stream().filter(t -> t.tipo().equals("bus")).toList();
    }

    @Test
    void directo() {
        var s = servicio(List.of(calle(1, 0), calle(2, 1), calle(3, 2)),
                List.of(linea(100, "A", 1, 2, 3)));

        PlanRuta plan = s.planificar(1, 3);

        assertEquals(1, plan.origen().id());
        assertEquals(3, plan.destino().id());
        assertEquals(1, plan.itinerarios().size());
        Itinerario it = plan.itinerarios().getFirst();
        assertEquals(0, it.trasbordos());
        assertEquals(0, it.metrosAndando());
        assertEquals(1, it.tramos().size());
        Tramo t = it.tramos().getFirst();
        assertEquals("bus", t.tipo());
        assertEquals("A", t.lineaNombre());
        assertEquals(100, t.lineaId());
        assertEquals(1, t.desde().id());
        assertEquals(3, t.hasta().id());
        assertEquals(2, t.paradas());
        assertEquals("Parada 3", t.hacia());
        assertNull(t.esperaMin());
        assertTrue(t.trazado().size() >= 2);
        // 5 min de espera + 2 tramos de ~555 m a 1,25/4,5 + 20 s cada uno ≈ 11 min
        assertTrue(it.minutos() >= 9 && it.minutos() <= 14, "minutos = " + it.minutos());
    }

    @Test
    void trasbordoEnLaMismaParada() {
        var s = servicio(List.of(calle(1, 0), calle(2, 1), calle(3, 2), calle(4, 3), calle(5, 4)),
                List.of(linea(100, "A", 1, 2, 3), linea(200, "B", 3, 4, 5)));

        Itinerario it = s.planificar(1, 5).itinerarios().getFirst();

        assertEquals(1, it.trasbordos());
        assertEquals(0, it.metrosAndando());
        List<Tramo> b = buses(it);
        assertEquals(List.of("A", "B"), b.stream().map(Tramo::lineaNombre).toList());
        assertEquals(3, b.get(0).hasta().id());
        assertEquals(3, b.get(1).desde().id());
        assertEquals(2, it.tramos().size());
    }

    @Test
    void trasbordoAndandoEntreDosParadasCercanas() {
        // La parada 13 está ~110 m de la 3 (misma calle, otra acera)
        var s = servicio(
                List.of(calle(1, 0), calle(2, 1), calle(3, 2), parada(13, LAT0 + 2 * PASO + 0.001, LNG0),
                        calle(4, 3), calle(5, 4)),
                List.of(linea(100, "A", 1, 2, 3), linea(200, "B", 13, 4, 5)));

        Itinerario it = s.planificar(1, 5).itinerarios().getFirst();

        assertEquals(1, it.trasbordos());
        assertEquals(List.of("bus", "andar", "bus"), it.tramos().stream().map(Tramo::tipo).toList());
        Tramo andar = it.tramos().get(1);
        assertEquals(3, andar.desde().id());
        assertEquals(13, andar.hasta().id());
        assertTrue(andar.metros() > 100 && andar.metros() < 200, "metros = " + andar.metros());
        assertEquals(andar.metros(), it.metrosAndando());
        assertNull(andar.lineaId());
        assertEquals(2, andar.trazado().size());
    }

    @Test
    void origenEnLaAceraContrariaAndaYSube() {
        // La 10 es la parada de enfrente de la 1 (~65 m), pero solo la sirve otra línea hacia el otro lado
        var s = servicio(
                List.of(calle(1, 0), calle(2, 1), calle(3, 2), parada(10, LAT0 + 0.0005, LNG0 + 0.0005),
                        parada(11, LAT0 - 0.01, LNG0)),
                List.of(linea(100, "A", 1, 2, 3), linea(300, "C", 10, 11)));

        Itinerario it = s.planificar(10, 3).itinerarios().getFirst();

        assertEquals(List.of("andar", "bus"), it.tramos().stream().map(Tramo::tipo).toList());
        assertEquals(10, it.tramos().get(0).desde().id());
        assertEquals(1, it.tramos().get(0).hasta().id());
        assertEquals("A", it.tramos().get(1).lineaNombre());
        assertEquals(0, it.trasbordos());
        assertTrue(it.metrosAndando() > 0);
    }

    @Test
    void eliminaLosPaseosCortosAlPrincipioYAlFinal() {
        // 10 está a ~30 m de la 1 y 14 a ~30 m de la 3: ambos paseos sobran
        var s = servicio(
                List.of(calle(1, 0), calle(2, 1), calle(3, 2), parada(10, LAT0 + 0.0002, LNG0),
                        parada(14, LAT0 + 2 * PASO + 0.0002, LNG0)),
                List.of(linea(100, "A", 1, 2, 3), linea(300, "C", 10, 14)));

        Itinerario it = s.planificar(10, 14).itinerarios().stream()
                .filter(i -> !buses(i).isEmpty() && buses(i).getFirst().lineaNombre().equals("A"))
                .findFirst().orElseThrow();

        assertEquals(List.of("bus"), it.tramos().stream().map(Tramo::tipo).toList());
        assertEquals(1, it.tramos().getFirst().desde().id());
        assertEquals(3, it.tramos().getFirst().hasta().id());
        assertEquals(0, it.metrosAndando());
    }

    @Test
    void sinCombinacionDevuelveListaVacia() {
        var s = servicio(
                List.of(calle(1, 0), calle(2, 1), calle(20, 10), calle(21, 11)),
                List.of(linea(100, "A", 1, 2), linea(400, "D", 20, 21)));

        PlanRuta plan = s.planificar(1, 21);

        assertTrue(plan.itinerarios().isEmpty());
        assertEquals(1, plan.origen().id());
    }

    @Test
    void noSubeAUnaRutaEnSentidoContrario() {
        var s = servicio(List.of(calle(1, 0), calle(2, 1), calle(3, 2)),
                List.of(linea(100, "A", 1, 2, 3)));

        assertTrue(s.planificar(3, 1).itinerarios().isEmpty());
        assertFalse(s.planificar(1, 3).itinerarios().isEmpty());
    }

    @Test
    void respetaElMaximoDeTrasbordos() {
        var paradas = List.of(calle(1, 0), calle(2, 1), calle(3, 2), calle(4, 3), calle(5, 4));
        var lineas = List.of(linea(100, "A", 1, 2), linea(200, "B", 2, 3),
                linea(300, "C", 3, 4), linea(400, "D", 4, 5));
        var s = servicio(paradas, lineas);

        // 1 → 4 son 3 buses (2 trasbordos): permitido
        Itinerario ok = s.planificar(1, 4).itinerarios().getFirst();
        assertEquals(2, ok.trasbordos());
        assertEquals(3, buses(ok).size());

        // 1 → 5 serían 4 buses (3 trasbordos): no hay itinerario
        assertTrue(s.planificar(1, 5).itinerarios().isEmpty());
    }

    @Test
    void alternativasConOtraLineaOrdenadasPorTiempo() {
        // A y B hacen lo mismo; B es algo más lenta (rodea por una parada más)
        var s = servicio(
                List.of(calle(1, 0), calle(2, 1), calle(3, 2), parada(9, LAT0 + PASO, LNG0 + 0.004)),
                List.of(linea(100, "A", 1, 2, 3), linea(200, "B", 1, 9, 3)));

        List<Itinerario> its = s.planificar(1, 3).itinerarios();

        assertEquals(2, its.size());
        assertEquals("A", buses(its.get(0)).getFirst().lineaNombre());
        assertEquals("B", buses(its.get(1)).getFirst().lineaNombre());
        assertTrue(its.get(0).minutos() <= its.get(1).minutos());
    }

    @Test
    void cercaAnadeElItinerarioSoloAndando() {
        // 1 → 2 son ~555 m: se puede ir andando además de en bus
        var s = servicio(List.of(calle(1, 0), calle(2, 1)), List.of(linea(100, "A", 1, 2)));

        List<Itinerario> its = s.planificar(1, 2).itinerarios();

        assertEquals(2, its.size());
        Itinerario andando = its.stream().filter(i -> buses(i).isEmpty()).findFirst().orElseThrow();
        assertEquals(1, andando.tramos().size());
        assertEquals("andar", andando.tramos().getFirst().tipo());
        assertEquals(0, andando.trasbordos());
        assertEquals(andando.tramos().getFirst().metros(), andando.metrosAndando());
    }

    @Test
    void usaLaEsperaRealDelPrimerBus() {
        var s = servicio(List.of(calle(1, 0), calle(2, 1), calle(3, 2)),
                List.of(linea(100, "A", 1, 2, 3)),
                id -> new LlegadasParada(id, "x", "00:00:00", List.of(
                        new LineaLlegadas(999, "Z", "#000000", List.of(new BusLlegada(1, 1, 100, 1, null, null, null, null))),
                        new LineaLlegadas(100, "A", "#0055AA", List.of(
                                new BusLlegada(7, 2, 800, 1, null, null, null, null))))));
        var sinEspera = servicio(List.of(calle(1, 0), calle(2, 1), calle(3, 2)),
                List.of(linea(100, "A", 1, 2, 3)));

        Itinerario con = s.planificar(1, 3).itinerarios().getFirst();
        Itinerario sin = sinEspera.planificar(1, 3).itinerarios().getFirst();

        assertEquals(2, buses(con).getFirst().esperaMin());
        assertEquals(sin.minutos() - 3, con.minutos());
    }

    @Test
    void siFallanLasLlegadasLaEsperaEsNula() {
        var s = servicio(List.of(calle(1, 0), calle(2, 1), calle(3, 2)),
                List.of(linea(100, "A", 1, 2, 3)),
                id -> {
                    throw new IllegalStateException("iTranvías caído");
                });

        Itinerario it = s.planificar(1, 3).itinerarios().getFirst();

        assertNull(buses(it).getFirst().esperaMin());
    }

    @Test
    void recortaElTrazadoDelRecorrido() {
        List<Parada> paradas = List.of(calle(1, 0), calle(2, 1), calle(3, 2), calle(4, 3));
        List<Linea> lineas = List.of(linea(100, "A", 1, 2, 3, 4));
        Catalogo cat = new Catalogo("test", lineas, paradas);

        // Trazado con un vértice cada 0,001° entre la calle 0 y la 3
        List<double[]> trazado = new ArrayList<>();
        for (int i = 0; i <= 3 * 5; i++) trazado.add(new double[]{LAT0 + i * 0.001, LNG0});
        var paradasRec = paradas.stream().map(p -> new ParadaRecorrido(p.id(), p.nombre(), p.lat(), p.lng())).toList();
        RecorridoLinea rec = new RecorridoLinea(100, "A", "#0055AA",
                List.of(new SentidoRecorrido(0, "Parada 4", paradasRec, trazado)));
        var s = new PlanificadorService(() -> cat, id -> null, id -> rec);

        Tramo t = s.planificar(2, 3).itinerarios().stream()
                .flatMap(i -> buses(i).stream()).findFirst().orElseThrow();

        // De la parada 2 (vértice 5) a la 3 (vértice 10): 6 vértices
        assertEquals(6, t.trazado().size());
        assertEquals(LAT0 + 5 * 0.001, t.trazado().getFirst()[0], 1e-9);
        assertEquals(LAT0 + 10 * 0.001, t.trazado().getLast()[0], 1e-9);
    }

    @Test
    void errores() {
        var s = servicio(List.of(calle(1, 0), calle(2, 1)), List.of(linea(100, "A", 1, 2)));

        var igual = assertThrows(ResponseStatusException.class, () -> s.planificar(1, 1));
        assertEquals(400, igual.getStatusCode().value());
        var noExiste = assertThrows(ResponseStatusException.class, () -> s.planificar(1, 999));
        assertEquals(404, noExiste.getStatusCode().value());
        var noExisteOrigen = assertThrows(ResponseStatusException.class, () -> s.planificar(999, 1));
        assertEquals(404, noExisteOrigen.getStatusCode().value());
    }
}
