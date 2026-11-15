package com.francoraguza.proyectobus.api;

import com.francoraguza.proyectobus.api.ApiDtos.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.time.LocalTime;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.function.IntFunction;
import java.util.function.Supplier;

/**
 * Planificador de rutas: dadas una parada de salida y otra de llegada, busca qué buses coger
 * (directo o con trasbordos) con Dijkstra por tiempo sobre el catálogo.
 *
 * Grafo de estados: (parada, a pie, buses usados) y (posición en una ruta, buses usados).
 * La lógica es pura sobre el {@link Catalogo}; las llegadas (espera real) y los recorridos
 * (trazado) se piden por funciones inyectadas, así se prueba sin red.
 */
@Service
public class PlanificadorService {

    // ---- Parámetros del modelo (segundos y metros) ----
    static final double ESPERA_PRIMER_BUS_S = 5 * 60;
    static final double ESPERA_TRASBORDO_S = 7 * 60;
    static final double FACTOR_BUS = 1.25;          // la calle es más larga que la recta
    static final double VELOCIDAD_BUS = 4.5;        // m/s
    static final double PARADA_BUS_S = 20;          // coste de cada parada intermedia
    static final double MAX_ANDAR_ENTRE_PARADAS_M = 350;
    static final double FACTOR_ANDAR = 1.3;
    static final double VELOCIDAD_ANDAR = 1.25;     // m/s
    static final double MIN_ANDAR_EXTREMO_M = 60;   // un paseo menor al principio/final se elimina
    static final int MAX_BUSES = 3;                 // 2 trasbordos
    static final double SOLO_ANDANDO_M = 1000;
    static final int MAX_ITINERARIOS = 3;
    static final double FACTOR_ALTERNATIVA = 1.6;
    static final double MARGEN_ALTERNATIVA_S = 10 * 60;

    private final Supplier<Catalogo> catalogo;
    private final IntFunction<LlegadasParada> llegadas;
    private final IntFunction<RecorridoLinea> recorrido;

    private volatile Grafo grafoCacheado;

    @Autowired
    public PlanificadorService(BusService bus) {
        this(bus::catalogo, bus::llegadas, bus::recorrido);
    }

    /** Para pruebas: catálogo, llegadas y recorridos sin red. */
    PlanificadorService(Supplier<Catalogo> catalogo, IntFunction<LlegadasParada> llegadas,
                        IntFunction<RecorridoLinea> recorrido) {
        this.catalogo = catalogo;
        this.llegadas = llegadas;
        this.recorrido = recorrido;
    }

    // ================= API pública =================

    public PlanRuta planificar(int origenId, int destinoId) {
        if (origenId == destinoId) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "El origen y el destino son la misma parada");
        }
        Grafo g = grafo(catalogo.get());
        Integer o = g.indice.get(origenId);
        Integer d = g.indice.get(destinoId);
        if (o == null) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Parada desconocida: " + origenId);
        if (d == null) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Parada desconocida: " + destinoId);

        // 1) Itinerarios en bus (mejor + alternativas prohibiendo cada línea de la mejor)
        List<Candidato> candidatos = new ArrayList<>(alternativas(g, o, d));
        // 2) Solo andando, si están cerca
        Candidato andando = null;
        if (g.distancia(o, d) <= SOLO_ANDANDO_M) andando = soloAndando(g, o, d);

        List<Candidato> todos = new ArrayList<>(candidatos);
        if (andando != null) todos.add(andando);
        todos.sort(Comparator.comparingDouble(Candidato::coste));
        if (todos.size() > MAX_ITINERARIOS) {
            List<Candidato> recorte = new ArrayList<>(todos.subList(0, MAX_ITINERARIOS));
            if (andando != null && !recorte.contains(andando)) recorte.set(MAX_ITINERARIOS - 1, andando);
            todos = recorte;
        }

        // 3) Espera real, tramos y trazado
        List<Itinerario> itinerarios = new ArrayList<>();
        for (Candidato c : todos) itinerarios.add(convertir(g, c));
        itinerarios.sort(Comparator.comparingInt(Itinerario::minutos));

        String consultado = LocalTime.now().format(DateTimeFormatter.ofPattern("HH:mm:ss"));
        return new PlanRuta(ref(g.paradas[o]), ref(g.paradas[d]), consultado, itinerarios);
    }

    // ================= Grafo =================

    private Grafo grafo(Catalogo cat) {
        Grafo g = grafoCacheado;
        if (g == null || g.catalogo != cat) {
            g = new Grafo(cat);
            grafoCacheado = g;
        }
        return g;
    }

    /** Una ruta de una línea: paradas (índices) y coste/metros de cada tramo hasta la siguiente. */
    private record Ruta(Linea linea, int[] paradas, double[] segMetros, double[] segCoste) {
    }

    private static final class Grafo {
        final Catalogo catalogo;
        final Parada[] paradas;
        final Map<Integer, Integer> indice = new HashMap<>();
        final List<Ruta> rutas = new ArrayList<>();
        /** «Estados de bus»: una entrada por (ruta, posición). */
        int[] bRuta;
        int[] bPos;
        int[] baseRuta;
        int nBus;
        /** Por parada, los estados de bus que la tocan. */
        int[][] abordajes;
        /** Paradas a pie (≤ 350 m en línea recta) y su distancia recta. */
        int[][] vecinos;
        double[][] distVecinos;

        Grafo(Catalogo cat) {
            this.catalogo = cat;
            this.paradas = cat.paradas().toArray(new Parada[0]);
            for (int i = 0; i < paradas.length; i++) indice.putIfAbsent(paradas[i].id(), i);

            Set<String> vistas = new HashSet<>();
            for (Linea l : cat.lineas()) {
                if (l.rutas() == null) continue;
                for (List<Integer> ruta : l.rutas()) {
                    int[] ps = ruta.stream().map(indice::get).filter(Objects::nonNull)
                            .mapToInt(Integer::intValue).toArray();
                    if (ps.length < 2) continue;
                    if (!vistas.add(l.id() + ":" + Arrays.toString(ps))) continue;
                    double[] metros = new double[ps.length - 1];
                    double[] coste = new double[ps.length - 1];
                    for (int i = 0; i < metros.length; i++) {
                        metros[i] = distancia(ps[i], ps[i + 1]);
                        coste[i] = metros[i] * FACTOR_BUS / VELOCIDAD_BUS + PARADA_BUS_S;
                    }
                    rutas.add(new Ruta(l, ps, metros, coste));
                }
            }

            baseRuta = new int[rutas.size()];
            int total = 0;
            for (int r = 0; r < rutas.size(); r++) {
                baseRuta[r] = total;
                total += rutas.get(r).paradas().length;
            }
            nBus = total;
            bRuta = new int[total];
            bPos = new int[total];
            List<List<Integer>> porParada = new ArrayList<>();
            for (int i = 0; i < paradas.length; i++) porParada.add(new ArrayList<>());
            for (int r = 0; r < rutas.size(); r++) {
                int[] ps = rutas.get(r).paradas();
                for (int pos = 0; pos < ps.length; pos++) {
                    int b = baseRuta[r] + pos;
                    bRuta[b] = r;
                    bPos[b] = pos;
                    porParada.get(ps[pos]).add(b);
                }
            }
            abordajes = new int[paradas.length][];
            for (int i = 0; i < paradas.length; i++) {
                abordajes[i] = porParada.get(i).stream().mapToInt(Integer::intValue).toArray();
            }

            // Vecinos a pie. 350 m son ~0,0032° de latitud: filtro barato antes del haversine
            double margenLat = MAX_ANDAR_ENTRE_PARADAS_M / 111_000d * 1.1;
            List<List<Integer>> vec = new ArrayList<>();
            List<List<Double>> dis = new ArrayList<>();
            for (int i = 0; i < paradas.length; i++) {
                vec.add(new ArrayList<>());
                dis.add(new ArrayList<>());
            }
            for (int i = 0; i < paradas.length; i++) {
                for (int j = i + 1; j < paradas.length; j++) {
                    if (Math.abs(paradas[i].lat() - paradas[j].lat()) > margenLat) continue;
                    double m = distancia(i, j);
                    if (m > MAX_ANDAR_ENTRE_PARADAS_M) continue;
                    vec.get(i).add(j);
                    dis.get(i).add(m);
                    vec.get(j).add(i);
                    dis.get(j).add(m);
                }
            }
            vecinos = new int[paradas.length][];
            distVecinos = new double[paradas.length][];
            for (int i = 0; i < paradas.length; i++) {
                vecinos[i] = vec.get(i).stream().mapToInt(Integer::intValue).toArray();
                distVecinos[i] = dis.get(i).stream().mapToDouble(Double::doubleValue).toArray();
            }
        }

        double distancia(int a, int b) {
            return haversine(paradas[a].lat(), paradas[a].lng(), paradas[b].lat(), paradas[b].lng());
        }
    }

    // ================= Dijkstra =================

    /**
     * Tramo en bruto. ruta >= 0: bus (a/b = posiciones en la ruta). ruta = -1: a pie
     * (pasos = índices de parada recorridos; metros = lo que se camina).
     */
    private record Tramito(int ruta, int a, int b, List<Integer> pasos, double coste, double metros) {
        boolean esBus() {
            return ruta >= 0;
        }
    }

    private record Candidato(List<Tramito> tramos, double coste) {
    }

    private record Item(double d, int s) {
    }

    private List<Candidato> alternativas(Grafo g, int o, int d) {
        Candidato mejor = buscar(g, o, d, Set.of());
        if (mejor == null) return List.of();

        List<Candidato> resultado = new ArrayList<>();
        resultado.add(mejor);
        Set<String> firmas = new HashSet<>();
        firmas.add(firma(g, mejor));
        for (String nombre : lineasUsadas(g, mejor)) {
            Candidato alt = buscar(g, o, d, Set.of(nombre));
            if (alt != null && firmas.add(firma(g, alt))) resultado.add(alt);
        }
        double limite = mejor.coste() * FACTOR_ALTERNATIVA + MARGEN_ALTERNATIVA_S;
        resultado.removeIf(c -> c.coste() > limite);
        resultado.sort(Comparator.comparingDouble(Candidato::coste));
        return resultado;
    }

    private static List<String> lineasUsadas(Grafo g, Candidato c) {
        List<String> nombres = new ArrayList<>();
        for (Tramito t : c.tramos()) {
            if (!t.esBus()) continue;
            String n = g.rutas.get(t.ruta()).linea().nombre();
            if (!nombres.contains(n)) nombres.add(n);
        }
        return nombres;
    }

    /** Secuencia de líneas (por número comercial) de un itinerario. */
    private static String firma(Grafo g, Candidato c) {
        StringJoiner sj = new StringJoiner(">");
        for (Tramito t : c.tramos()) if (t.esBus()) sj.add(g.rutas.get(t.ruta()).linea().nombre());
        return sj.toString();
    }

    /** Camino más rápido o null si no hay combinación con ≤ 3 buses. */
    private Candidato buscar(Grafo g, int origen, int destino, Set<String> prohibidas) {
        final int n = g.paradas.length;
        final int nPie = n * 4;                      // estado a pie: parada*4 + buses usados (0..3)
        final int total = nPie + g.nBus * 3;         // estado en bus: nPie + b*3 + (buses usados - 1)
        double[] dist = new double[total];
        int[] prev = new int[total];
        Arrays.fill(dist, Double.POSITIVE_INFINITY);
        Arrays.fill(prev, -1);

        PriorityQueue<Item> cola = new PriorityQueue<>(Comparator.comparingDouble(Item::d));
        dist[origen * 4] = 0;
        cola.add(new Item(0, origen * 4));
        int fin = -1;

        while (!cola.isEmpty()) {
            Item it = cola.poll();
            int s = it.s();
            if (it.d() > dist[s]) continue;

            if (s < nPie) {
                int p = s >> 2;
                int k = s & 3;
                if (p == destino && k >= 1) {
                    fin = s;
                    break;
                }
                // Andar a una parada cercana
                int[] vs = g.vecinos[p];
                for (int i = 0; i < vs.length; i++) {
                    double c = g.distVecinos[p][i] * FACTOR_ANDAR / VELOCIDAD_ANDAR;
                    relajar(dist, prev, cola, vs[i] * 4 + k, s, it.d() + c);
                }
                // Subir a una ruta
                if (k < MAX_BUSES) {
                    double espera = k == 0 ? ESPERA_PRIMER_BUS_S : ESPERA_TRASBORDO_S;
                    for (int b : g.abordajes[p]) {
                        Ruta ru = g.rutas.get(g.bRuta[b]);
                        if (prohibidas.contains(ru.linea().nombre())) continue;
                        if (g.bPos[b] == ru.paradas().length - 1) continue;   // en la última parada no se sube
                        relajar(dist, prev, cola, nPie + b * 3 + k, s, it.d() + espera);
                    }
                }
            } else {
                int x = s - nPie;
                int b = x / 3;
                int k = x % 3 + 1;
                Ruta ru = g.rutas.get(g.bRuta[b]);
                int pos = g.bPos[b];
                relajar(dist, prev, cola, ru.paradas()[pos] * 4 + k, s, it.d());          // bajar
                if (pos < ru.paradas().length - 1) {                                      // seguir
                    relajar(dist, prev, cola, nPie + (b + 1) * 3 + (k - 1), s, it.d() + ru.segCoste()[pos]);
                }
            }
        }
        if (fin < 0) return null;

        // Reconstruir el camino de estados
        ArrayDeque<Integer> camino = new ArrayDeque<>();
        for (int s = fin; s != -1; s = prev[s]) camino.addFirst(s);
        Integer[] st = camino.toArray(new Integer[0]);

        List<Tramito> tramos = new ArrayList<>();
        int rutaActual = -1;
        int posIni = -1;
        for (int t = 1; t < st.length; t++) {
            int from = st[t - 1];
            int to = st[t];
            boolean desdePie = from < nPie;
            boolean aPie = to < nPie;
            if (desdePie && aPie) {
                añadirAndar(g, tramos, from >> 2, to >> 2);
            } else if (desdePie) {
                int b = (to - nPie) / 3;
                rutaActual = g.bRuta[b];
                posIni = g.bPos[b];
            } else if (aPie) {
                int b = (from - nPie) / 3;
                int posFin = g.bPos[b];
                if (posFin > posIni) {
                    Ruta ru = g.rutas.get(rutaActual);
                    double coste = 0;
                    for (int i = posIni; i < posFin; i++) coste += ru.segCoste()[i];
                    tramos.add(new Tramito(rutaActual, posIni, posFin, List.of(), coste, 0));
                }
            }
        }
        // Los tramos a pie de 0 m (dos paradas en el mismo punto) no se muestran
        tramos.removeIf(t -> !t.esBus() && Math.round(t.metros()) == 0);
        // Un paseo corto al principio o al final sobra: el itinerario empieza/termina en la parada del bus
        double coste = dist[fin];
        while (tramos.size() > 1 && esPaseoCorto(tramos.getFirst())) coste -= tramos.removeFirst().coste();
        while (tramos.size() > 1 && esPaseoCorto(tramos.getLast())) coste -= tramos.removeLast().coste();
        return new Candidato(tramos, coste);
    }

    private static boolean esPaseoCorto(Tramito t) {
        return !t.esBus() && t.metros() < MIN_ANDAR_EXTREMO_M;
    }

    private static void relajar(double[] dist, int[] prev, PriorityQueue<Item> cola, int destino, int origen, double d) {
        if (d < dist[destino]) {
            dist[destino] = d;
            prev[destino] = origen;
            cola.add(new Item(d, destino));
        }
    }

    /** Añade un paso a pie; si el tramo anterior ya era a pie, lo fusiona. */
    private static void añadirAndar(Grafo g, List<Tramito> tramos, int a, int b) {
        double m = g.distancia(a, b) * FACTOR_ANDAR;
        if (!tramos.isEmpty() && !tramos.getLast().esBus()) {
            Tramito ant = tramos.removeLast();
            List<Integer> pasos = new ArrayList<>(ant.pasos());
            pasos.add(b);
            tramos.add(new Tramito(-1, 0, 0, pasos, ant.coste() + m / VELOCIDAD_ANDAR, ant.metros() + m));
        } else {
            tramos.add(new Tramito(-1, 0, 0, List.of(a, b), m / VELOCIDAD_ANDAR, m));
        }
    }

    private Candidato soloAndando(Grafo g, int o, int d) {
        double m = g.distancia(o, d) * FACTOR_ANDAR;
        return new Candidato(List.of(new Tramito(-1, 0, 0, List.of(o, d), m / VELOCIDAD_ANDAR, m)),
                m / VELOCIDAD_ANDAR);
    }

    // ================= Conversión a DTOs =================

    private Itinerario convertir(Grafo g, Candidato c) {
        double totalS = c.coste();
        Integer espera = null;

        int primero = -1;
        double andarAntes = 0;
        for (int i = 0; i < c.tramos().size(); i++) {
            Tramito t = c.tramos().get(i);
            if (t.esBus()) {
                primero = i;
                break;
            }
            andarAntes += t.coste();
        }
        if (primero >= 0) {
            Tramito t = c.tramos().get(primero);
            Ruta ru = g.rutas.get(t.ruta());
            espera = esperaReal(ru.linea().id(), g.paradas[ru.paradas()[t.a()]].id(), andarAntes);
            if (espera != null) totalS += espera * 60d - ESPERA_PRIMER_BUS_S - andarAntes;
        }

        List<Tramo> tramos = new ArrayList<>();
        int buses = 0;
        int andando = 0;
        for (int i = 0; i < c.tramos().size(); i++) {
            Tramo tr = tramo(g, c.tramos().get(i), i == primero ? espera : null);
            tramos.add(tr);
            if (tr.tipo().equals("bus")) buses++;
            else andando += tr.metros();
        }
        int minutos = Math.max(1, (int) Math.round(totalS / 60d));
        return new Itinerario(minutos, Math.max(0, buses - 1), andando, tramos);
    }

    private Tramo tramo(Grafo g, Tramito t, Integer espera) {
        if (!t.esBus()) {
            List<double[]> trazado = new ArrayList<>();
            for (int idx : t.pasos()) trazado.add(new double[]{g.paradas[idx].lat(), g.paradas[idx].lng()});
            int metros = (int) Math.round(t.metros());
            int a = t.pasos().getFirst();
            int b = t.pasos().getLast();
            return new Tramo("andar", null, null, null, null, ref(g.paradas[a]), ref(g.paradas[b]),
                    0, metros, Math.max(1, (int) Math.round(t.coste() / 60d)), null, trazado);
        }
        Ruta ru = g.rutas.get(t.ruta());
        Parada desde = g.paradas[ru.paradas()[t.a()]];
        Parada hasta = g.paradas[ru.paradas()[t.b()]];
        Parada ultima = g.paradas[ru.paradas()[ru.paradas().length - 1]];
        double metros = 0;
        for (int i = t.a(); i < t.b(); i++) metros += ru.segMetros()[i];
        return new Tramo("bus", ru.linea().id(), ru.linea().nombre(), ru.linea().color(), ultima.nombre(),
                ref(desde), ref(hasta), t.b() - t.a(), (int) Math.round(metros * FACTOR_BUS),
                Math.max(1, (int) Math.round(t.coste() / 60d)), espera,
                trazadoBus(ru.linea(), desde, hasta));
    }

    // ================= Espera real =================

    /**
     * Minutos hasta el próximo bus de esa línea (mismo id) en la parada de subida, o null.
     * Si antes hay que andar, solo cuentan los buses que se pueden alcanzar.
     */
    private Integer esperaReal(int lineaId, int paradaId, double andarAntesS) {
        try {
            LlegadasParada ll = llegadas.apply(paradaId);
            if (ll == null || ll.lineas() == null) return null;
            for (LineaLlegadas l : ll.lineas()) {
                if (l.id() != lineaId || l.buses() == null) continue;
                Integer mejor = null;
                for (BusLlegada b : l.buses()) {
                    if (b.minutos() == null || b.minutos() * 60d < andarAntesS) continue;
                    if (mejor == null || b.minutos() < mejor) mejor = b.minutos();
                }
                return mejor;
            }
            return null;
        } catch (RuntimeException e) {
            return null;
        }
    }

    // ================= Trazado =================

    private List<double[]> trazadoBus(Linea linea, Parada desde, Parada hasta) {
        try {
            RecorridoLinea rec = recorrido.apply(linea.id());
            if (rec != null && rec.sentidos() != null) {
                for (SentidoRecorrido s : rec.sentidos()) {
                    int iD = -1;
                    int iH = -1;
                    List<ParadaRecorrido> ps = s.paradas();
                    for (int k = 0; k < ps.size(); k++) {
                        if (iD < 0) {
                            if (ps.get(k).id() == desde.id()) iD = k;
                        } else if (ps.get(k).id() == hasta.id()) {
                            iH = k;
                            break;
                        }
                    }
                    if (iD < 0 || iH < 0 || s.trazado() == null || s.trazado().size() < 2) continue;
                    List<double[]> t = s.trazado();
                    int a = masCercano(t, 0, desde.lat(), desde.lng());
                    int b = masCercano(t, a, hasta.lat(), hasta.lng());
                    if (b > a) return new ArrayList<>(t.subList(a, b + 1));
                }
            }
        } catch (RuntimeException e) {
            // sin recorrido: se cae a la línea recta
        }
        return List.of(new double[]{desde.lat(), desde.lng()}, new double[]{hasta.lat(), hasta.lng()});
    }

    private static int masCercano(List<double[]> t, int desde, double lat, double lng) {
        int mejor = desde;
        double dm = Double.POSITIVE_INFINITY;
        for (int i = desde; i < t.size(); i++) {
            double d = haversine(lat, lng, t.get(i)[0], t.get(i)[1]);
            if (d < dm) {
                dm = d;
                mejor = i;
            }
        }
        return mejor;
    }

    // ================= Utilidades =================

    private static ParadaRef ref(Parada p) {
        return new ParadaRef(p.id(), p.nombre(), p.lat(), p.lng());
    }

    static double haversine(double lat1, double lng1, double lat2, double lng2) {
        double r = 6_371_000;
        double dLat = Math.toRadians(lat2 - lat1);
        double dLng = Math.toRadians(lng2 - lng1);
        double h = Math.pow(Math.sin(dLat / 2), 2)
                + Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2)) * Math.pow(Math.sin(dLng / 2), 2);
        return 2 * r * Math.asin(Math.sqrt(h));
    }
}
