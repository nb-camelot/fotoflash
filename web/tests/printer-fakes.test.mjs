// Stampante BLE finta per le prove dell'area printer (nessuna prova qui: solo strumenti condivisi).
// Riprende device()/load() di test/ble-test.js del bridge: servizi, caratteristiche, scritture
// con latenza, errori programmabili e, come Chrome, solo i servizi dichiarati sono visibili.

export const U = (s) => '0000' + s + '-0000-1000-8000-00805f9b34fb';
export const S18F0 = U('18f0');
export const C2AF1 = U('2af1');
export const C2AF0 = U('2af0');
export const SFFF0 = U('fff0');
export const CFFF2 = U('fff2');
export const CFFF1 = U('fff1');
export const SAE30 = U('ae30');
export const CAE01 = U('ae01');
export const SISSC = '49535343-fe7d-4ae5-8fa9-9fafd205e455';
export const CISSC = '49535343-8841-43f4-a8d4-ecbe34729bb3';
export const SUNDECLARED = '12345678-1234-1234-1234-123456789abc';

export function dom(name, msg) { return new DOMException(msg, name); }

export function storage() {
  const m = {};
  return {
    m,
    getItem: (k) => (k in m ? m[k] : null),
    setItem: (k, v) => { m[k] = String(v); },
    removeItem: (k) => { delete m[k]; }
  };
}

// Timer accelerati (SCALE volte): 20 s di timeout diventano 400 ms. log = attese richieste.
export function fastTimers(scale = 50) {
  const log = [];
  return {
    log,
    setTimeout: (fn, ms) => { log.push(ms); return setTimeout(fn, Math.max(0, (ms || 0) / scale)); },
    clearTimeout: (id) => clearTimeout(id)
  };
}

// Dispositivo finto. services: { uuid: [[charUuid, props], ...] }.
export function device(opts) {
  const o = Object.assign({ name: 'BlueTooth Printer', id: 'dev-1', services: {}, connect: null, fail: null, latency: 1, advertises: false }, opts);
  const listeners = {};
  const dev = {
    name: o.name, id: o.id, writes: [], calls: 0, connectCalls: 0, inFlight: 0, overlap: 0, forgotten: false, allowed: [],
    watchCalls: 0, watchAborted: false,
    addEventListener(t, fn) { (listeners[t] = listeners[t] || []).push(fn); },
    removeEventListener(t, fn) { listeners[t] = (listeners[t] || []).filter((f) => f !== fn); },
    dispatch(t) { (listeners[t] || []).slice().forEach((f) => f({ type: t, target: dev })); },
    forget() { dev.forgotten = true; return Promise.resolve(); },
    listenerCount(t) { return (listeners[t] || []).length; },
    watchAdvertisements(options) {
      dev.watchCalls++;
      if (options && options.signal) options.signal.addEventListener('abort', () => { dev.watchAborted = true; });
      if (o.advertises) setTimeout(() => dev.dispatch('advertisementreceived'), 2);
      return Promise.resolve();
    }
  };
  function write(uuid, v, withResponse) {
    const n = dev.calls++;
    if (!dev.gatt.connected) return Promise.reject(dom('NetworkError', 'GATT Server is disconnected. Cannot perform GATT operations.'));
    if (dev.inFlight > 0) dev.overlap++;
    dev.inFlight++;
    const bytes = Array.from(v);
    const err = o.fail ? o.fail({ n, len: bytes.length, withResponse, uuid, dev }) : null;
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        dev.inFlight--;
        if (err) return reject(err);
        dev.writes.push({ uuid, bytes, withResponse });
        resolve();
      }, o.latency);
    });
  }
  const chars = {};
  Object.keys(o.services).forEach((s) => {
    chars[s] = o.services[s].map(([uuid, props]) => ({
      uuid,
      properties: Object.assign({ read: false, write: false, writeWithoutResponse: false, notify: false }, props),
      writeValueWithResponse: (v) => write(uuid, v, true),
      writeValueWithoutResponse: (v) => write(uuid, v, false)
    }));
  });
  function svc(u) {
    return {
      uuid: u,
      getCharacteristic(c) {
        const f = chars[u].find((x) => x.uuid === c);
        return f ? Promise.resolve(f) : Promise.reject(dom('NotFoundError', 'No Characteristics matching UUID ' + c + ' found in Service.'));
      },
      getCharacteristics() { return Promise.resolve(chars[u].slice()); }
    };
  }
  const server = {
    // Come Chrome: si vedono solo i servizi dichiarati in filters/optionalServices.
    getPrimaryServices() {
      return Promise.resolve(Object.keys(o.services).filter((u) => dev.allowed.indexOf(u) >= 0).map(svc));
    }
  };
  dev.gatt = {
    connected: false,
    connect() {
      dev.connectCalls++;
      const r = o.connect ? o.connect(dev.connectCalls) : null;
      if (r === 'hang') return new Promise(() => {});
      if (r) return Promise.reject(r);
      dev.gatt.connected = true;
      return Promise.resolve(server);
    },
    disconnect() {
      if (!dev.gatt.connected) return;
      dev.gatt.connected = false;
      dev.dispatch('gattserverdisconnected');
    }
  };
  return dev;
}

/** La stampante dell'utente: servizio 18F0, notifica su 2AF0, scrittura su 2AF1. */
export function netum(extra) {
  return device(Object.assign({
    services: { [S18F0]: [[C2AF0, { notify: true }], [C2AF1, { write: true, writeWithoutResponse: true }]] }
  }, extra));
}

/** navigator finto con bluetooth: il chooser restituisce i dispositivi in ordine, poi "annullato". */
export function fakeBluetooth({ devices = [], remember = false, throwSync = null, activation = null } = {}) {
  const nav = {
    requests: [],
    queue: devices.slice(),
    bluetooth: {
      requestDevice(options) {
        nav.requests.push(options);
        if (throwSync) throw throwSync;
        const d = nav.queue.shift();
        if (!d) return Promise.reject(dom('NotFoundError', 'User cancelled the requestDevice() chooser.'));
        d.allowed = (options.optionalServices || []).concat(
          (options.filters || []).flatMap((f) => f.services || []));
        return Promise.resolve(d);
      },
      getAvailability() { return Promise.resolve(true); }
    }
  };
  if (activation !== null) nav.userActivation = { isActive: activation, hasBeenActive: activation };
  if (remember) nav.bluetooth.getDevices = () => Promise.resolve(devices.slice());
  return nav;
}

export function data(n, seed = 7) {
  const a = new Uint8Array(n);
  for (let i = 0; i < n; i++) a[i] = (i * 31 + seed) & 0xFF;
  return a;
}

export function delivered(dev) { return dev.writes.flatMap((w) => w.bytes); }

export async function rejects(p) {
  try { await p; } catch (e) { return e; }
  throw new Error('doveva fallire');
}
