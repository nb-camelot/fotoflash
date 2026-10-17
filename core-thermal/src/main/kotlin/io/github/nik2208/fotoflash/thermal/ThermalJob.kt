package io.github.nik2208.fotoflash.thermal

/**
 * Trasforma un'immagine a 1 bit nella sequenza di pacchetti da inviare alla stampante.
 *
 * Un pacchetto per banda raster: il trasporto li spezza ancora in blocchi con pause, ma tenerli
 * separati permette di misurare l'avanzamento. Ogni comando comincia e finisce nello stesso
 * pacchetto; se pero il collegamento cade (o il trasporto si blocca) a meta di un pacchetto, la
 * stampante puo restare dentro un GS v 0 aperto e mangiarsi come dati raster i comandi del lavoro
 * successivo. Prima di rimandare un lavoro interrotto va quindi inviato [resyncFor].
 */
object ThermalJob {

    /**
     * Pacchetti in ordine di invio:
     * 1. ESC @ (+ ESC 7 se [PrintJobOptions.heat] non e null);
     * 2. una banda GS v 0 per pacchetto, di [PrintJobOptions.bandHeight] righe (1..255; l'ultima puo essere piu corta);
     * 3. ESC d [PrintJobOptions.feedLinesAfter] (+ GS V 66 0, taglio parziale, se [PrintJobOptions.cut]).
     */
    fun build(image: BitImage, options: PrintJobOptions): List<ByteArray> {
        val packets = ArrayList<ByteArray>(image.height / options.bandHeight.coerceIn(1, 255) + 3)

        val head = EscPosBuilder().init()
        val heat = options.heat
        if (heat != null) head.heat(heat)
        packets.add(head.bytes())

        val band = options.bandHeight.coerceIn(1, 255)
        var row = 0
        while (row < image.height) {
            val rows = minOf(band, image.height - row)
            packets.add(EscPosRaster.band(image, row, rows))
            row += rows
        }

        val tail = EscPosBuilder().feed(options.feedLinesAfter)
        if (options.cut) tail.cut(partial = true)
        packets.add(tail.bytes())
        return packets
    }

    /** Byte totali di un lavoro: serve per la percentuale e per l'attesa di svuotamento del buffer. */
    fun totalBytes(packets: List<ByteArray>): Int = packets.sumOf { it.size }

    /**
     * Sequenza di risincronizzazione dopo una banda GS v 0 interrotta di [bytesPerRow] byte per riga
     * e [bandHeight] righe (1..255): tanti NUL quanti ne servono a chiudere anche una banda appena
     * cominciata. Dentro il comando aperto diventano righe bianche (al massimo una banda di carta);
     * fuori da un comando le stampanti ESC/POS ignorano lo 0x00.
     */
    fun resync(bytesPerRow: Int, bandHeight: Int): ByteArray =
        ByteArray(EscPosRaster.HEADER_SIZE + bytesPerRow.coerceAtLeast(1) * bandHeight.coerceIn(1, 255))

    /**
     * Risincronizzazione dimensionata sul lavoro INTERROTTO ([packets], cosi come era stato
     * costruito: anche la pagina di prova): NUL lunghi quanto il pacchetto piu grande. Ogni comando
     * sta dentro un pacchetto, quindi nessun comando rimasto aperto puo aspettare piu byte di cosi.
     * Va inviata una volta sola, prima del lavoro successivo, e solo dopo un invio interrotto: lo
     * stato del parser e nella stampante, il chiamante deve ricordarsi che l'invio si e rotto (vale
     * finche vive il processo e solo per questo telefono). Lista vuota = array vuoto.
     */
    fun resyncFor(packets: List<ByteArray>): ByteArray = ByteArray(packets.maxOfOrNull { it.size } ?: 0)
}
