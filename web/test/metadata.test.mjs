import assert from "node:assert/strict";
import test from "node:test";
import { readMetadata } from "../metadata.js";

function frame(id, data) {
  const header = Buffer.alloc(10);
  header.write(id, 0, "ascii");
  header.writeUInt32BE(data.length, 4);
  return Buffer.concat([header, data]);
}

function taggedMp3() {
  const text = (value) => Buffer.concat([Buffer.from([0]), Buffer.from(value, "latin1")]);
  const picture = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
  const tags = Buffer.concat([
    frame("TIT2", text("Road Song")),
    frame("TPE1", text("Sample Artist")),
    frame("TALB", text("Demo Album")),
    frame("APIC", Buffer.concat([Buffer.from("\0image/png\0\x03\0", "latin1"), picture])),
  ]);
  const header = Buffer.from([
    0x49, 0x44, 0x33, 3, 0, 0,
    (tags.length >> 21) & 127, (tags.length >> 14) & 127,
    (tags.length >> 7) & 127, tags.length & 127,
  ]);
  const audio = Buffer.alloc(417 * 3);
  for (let offset = 0; offset < audio.length; offset += 417) {
    Buffer.from([0xff, 0xfb, 0x90, 0x64]).copy(audio, offset);
  }
  return new File([header, tags, audio], "tagged.mp3", { type: "audio/mpeg" });
}

test("reads ID3 title, artist, album and embedded artwork", async () => {
  const metadata = await readMetadata(taggedMp3());
  assert.equal(metadata.title, "Road Song");
  assert.equal(metadata.artist, "Sample Artist");
  assert.equal(metadata.album, "Demo Album");
  assert.equal(metadata.picture.format, "image/png");
  assert.equal(metadata.picture.data.byteLength, 16);
});

test("reports invalid music metadata rather than fabricating tags", async () => {
  await assert.rejects(readMetadata(new File(["invalid"], "bad.mp3", { type: "audio/mpeg" })));
});
