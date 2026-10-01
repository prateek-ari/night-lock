let settings = null;
export function configure(value) { settings = value; }
export function log(message) { console.log(`[NightLock] ${message}`); }
export function debug(message) {
    if (settings?.get_boolean('debug-logging'))
        log(message);
}
