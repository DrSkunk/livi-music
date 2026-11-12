import assert from "node:assert/strict";
import test from "node:test";
import { verificationCode } from "../verification.js";

const sdp = (byte) => `v=0\r\na=fingerprint:sha-256 ${Array(32).fill(byte).join(":")}\r\n`;

test("matches LIVI's verification code for the offer and answer fingerprints", async () => {
  assert.equal(await verificationCode(sdp("11"), sdp("22")), "F010287B");
  assert.notEqual(await verificationCode(sdp("22"), sdp("11")), "F010287B");
});

test("rejects missing, malformed or conflicting fingerprints", async () => {
  await assert.rejects(verificationCode("v=0\r\n", sdp("22")), /missing/);
  await assert.rejects(verificationCode("a=fingerprint:sha-256 AB:CD\r\n", sdp("22")), /Invalid/);
  await assert.rejects(verificationCode(sdp("11") + sdp("33"), sdp("22")), /Conflicting/);
});
