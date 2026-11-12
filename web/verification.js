"use strict";

// Must match verification_code() in LIVI's livi-music-sync transfer.rs.
export function fingerprint(sdp) {
  let found = null;
  for (const line of String(sdp || "").split("\n")) {
    const prefix = "a=fingerprint:sha-256 ";
    const trimmed = line.replace(/\r$/, "");
    if (!trimmed.startsWith(prefix)) continue;
    const value = trimmed.slice(prefix.length).replaceAll(":", "").toUpperCase();
    if (!/^[0-9A-F]{64}$/.test(value)) throw new Error("Invalid peer fingerprint");
    if (found !== null && found !== value) throw new Error("Conflicting peer fingerprints");
    found = value;
  }
  if (found === null) throw new Error("Peer fingerprint is missing");
  return found;
}

export async function verificationCode(offer, answer) {
  const text = `${fingerprint(offer)}\n${fingerprint(answer)}`;
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return [...hash.slice(0, 4)].map((byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
}
