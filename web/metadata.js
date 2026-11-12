import { parseBlob } from "music-metadata";

export async function readMetadata(file) {
  const metadata = await parseBlob(file, { duration: false });
  const { title, artist, album, picture } = metadata.common;
  if (!metadata.format.hasAudio && !title && !artist && !album && !picture?.length) {
    throw new Error("No readable audio stream or tags found");
  }
  return { title, artist, album, picture: picture?.[0], duration: metadata.format.duration };
}

if (typeof window !== "undefined") window.LIVI_MUSIC_METADATA = { read: readMetadata };
