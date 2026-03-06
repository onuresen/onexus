/**
 * onexus-logger.js
 *
 * Lightweight debug logger for ONEXUS.
 * Set window.ONEXUS_DEBUG = true (or ?debug=1 in URL) before loading to enable
 * verbose console.log / console.table output. warn and error are always active.
 *
 * Usage:
 *   const LOG = window.ONEXUS_LOG;
 *   LOG.log("something happened", data);   // only shown when ONEXUS_DEBUG=true
 *   LOG.table({ a: 1, b: 2 });             // only shown when ONEXUS_DEBUG=true
 *   LOG.warn("soft warning", e);           // always shown
 *   LOG.error("hard failure", e);          // always shown
 */
(function () {
    const debug =
        window.ONEXUS_DEBUG === true ||
        new URLSearchParams(window.location.search).get("debug") === "1";

    const noop = () => {};

    window.ONEXUS_LOG = {
        log: debug ? console.log.bind(console) : noop,
        table: debug ? console.table.bind(console) : noop,
        info: debug ? console.info.bind(console) : noop,
        warn: console.warn.bind(console),
        error: console.error.bind(console),
        debug: debug ? console.debug.bind(console) : noop
    };
})();
