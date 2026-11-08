// JWT fixtures for the hosted tests. generateKeyPairSync("rsa") at import time
// stalls on Node 20: OpenSSL leaves a file-close request in flight, the sync
// call sits on the main thread, and the test file never reports a subtest.
// The runner then kills the file at --test-timeout. Async generation lets
// that close finish. One key per process.
import { generateKeyPair as generateKeyPairCallback } from "node:crypto";
import { promisify } from "node:util";

const generateKeyPair = promisify(generateKeyPairCallback);
let pending;

export function testSigningKey() {
  pending ??= generateKeyPair("rsa", { modulusLength: 2048 }).then(({ privateKey, publicKey }) => {
    const jwk = { ...publicKey.export({ format: "jwk" }), kid: "test-key", alg: "RS256", use: "sig" };
    return { privateKey, jwk };
  });
  return pending;
}
