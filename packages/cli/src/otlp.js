// @ts-nocheck
import { buildResource, compileOtlpSpans, parseOtlpHeaders, sendOtlpHttp, } from '../../otlp-core/src/index.js';
export { buildResource };
export function parseHeaders(input) {
    return parseOtlpHeaders(input);
}
export function compileOtlp(events, resource) {
    return compileOtlpSpans(events, resource);
}
export async function sendOtlp(endpoint, payload, headers = {}) {
    await sendOtlpHttp(endpoint, payload, headers);
}
