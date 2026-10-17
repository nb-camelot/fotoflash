package io.github.nik2208.fotoflash.thermal

/**
 * Trasforma un'immagine a 1 bit nella sequenza di pacchetti da inviare alla stampante.
 *
 * Un pacchetto per banda raster: il trasporto li spezza ancora in blocchi con pause, ma tenerli
 * separati permette di misurare l'avanzamento e di non lasciare mai un comando GS v 0 a meta
 * tra due stampe.
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
}
