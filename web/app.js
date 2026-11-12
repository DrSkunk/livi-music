"use strict";

import { Peer } from "peerjs";
import { verificationCode } from "./verification.js";

(() => {
  const $ = (id) => document.getElementById(id);
  const config = window.LIVI_MUSIC_CONFIG || {};
  const fields = {
    form: $("connect-form"),
    code: $("pairing-code"),
    connect: $("connect"),
    disconnect: $("disconnect"),
    status: $("status"),
    verification: $("verification"),
    verificationCode: $("verification-code"),
    library: $("library"),
    location: $("location"),
    entries: $("entries"),
    refresh: $("refresh"),
    files: $("files"),
    folder: $("folder"),
    selection: $("selection"),
    selectionCount: $("selection-count"),
    selectionList: $("selection-list"),
    preview: $("preview"),
    previewArtwork: $("preview-artwork"),
    previewTitle: $("preview-title"),
    previewArtist: $("preview-artist"),
    previewAlbum: $("preview-album"),
    previewNote: $("preview-note"),
    previewAudio: $("preview-audio"),
    previewPlayer: $("preview-player"),
    previewPlay: $("preview-play"),
    previewSeek: $("preview-seek"),
    previewTime: $("preview-time"),
    upload: $("upload"),
    progressArea: $("progress-area"),
    progressLabel: $("progress-label"),
    progress: $("progress"),
    message: $("message"),
  };
  const extension = /\.(mp3|flac|wav|wave|aac|m4a|ogg|opus|m3u8?)$/i;
  const maxFileSize = 2 * 1024 * 1024 * 1024;
  const maxArtworkSize = 4 * 1024 * 1024;
  const audioTypes = {
    mp3: "audio/mpeg", flac: "audio/flac", wav: "audio/wav", wave: "audio/wav",
    aac: "audio/aac", m4a: "audio/mp4", ogg: "audio/ogg", opus: "audio/ogg",
  };
  let connection = null;
  let channel = null;
  let approved = false;
  let uploading = false;
  let currentPath = "";
  let sequence = 0;
  let uploadGeneration = 0;
  let previewGeneration = 0;
  let artworkUrl = null;
  let audioUrl = null;
  const pending = new Map();

  function displayStatus(text) {
    fields.status.textContent = text;
  }

  function stop(reason) {
    const oldChannel = channel;
    const oldConnection = connection;
    channel = null;
    connection = null;
    approved = false;
    uploading = false;
    uploadGeneration++;
    fields.previewAudio.pause();
    if (oldChannel) oldChannel.close();
    if (oldConnection) oldConnection.destroy();
    for (const { reject, timer } of pending.values()) {
      clearTimeout(timer);
      reject(new Error(reason));
    }
    pending.clear();
    fields.connect.disabled = false;
    fields.disconnect.disabled = true;
    fields.library.hidden = true;
    fields.verification.hidden = true;
    fields.upload.disabled = false;
    fields.refresh.disabled = false;
    fields.files.disabled = false;
    fields.folder.disabled = false;
    displayStatus(reason);
  }

  function peerIdFromLink() {
    const peerId = location.hash.slice(1);
    if (!/^[A-Za-z0-9]+(?:[ _-][A-Za-z0-9]+)*$/.test(peerId) || peerId.length > 128) {
      throw new Error("Open the LIVI Music link shown on LIVI to select the correct device.");
    }
    return peerId;
  }

  function toHex(bytes) {
    return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  function request(type, payload = {}) {
    if (!approved || !channel || !channel.open) {
      return Promise.reject(new Error("LIVI is not connected."));
    }
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error("LIVI did not respond to the request."));
      }, 15 * 60 * 1000);
      pending.set(id, { resolve, reject, timer });
      try {
        channel.send(JSON.stringify({ type, request: id, ...payload }));
      } catch (error) {
        clearTimeout(timer);
        pending.delete(id);
        reject(error);
      }
    });
  }

  async function showVerification() {
    const data = channel;
    const pc = data?.peerConnection;
    try {
      const code = await verificationCode(pc?.localDescription?.sdp, pc?.remoteDescription?.sdp);
      if (channel !== data) return;
      fields.verificationCode.textContent = code;
      fields.verification.hidden = false;
      displayStatus("Waiting for approval on LIVI.");
    } catch (error) {
      if (channel === data) stop(`Cannot verify this connection: ${error.message}`);
    }
  }

  function receive(message) {
    let response;
    try {
      response = JSON.parse(message);
    } catch (error) {
      stop(`Invalid message from LIVI: ${error.message}`);
      return;
    }
    if (response.type === "pending") {
      showVerification();
      return;
    }
    if (response.type === "approved") {
      approved = true;
      fields.library.hidden = false;
      fields.verification.hidden = true;
      displayStatus("Connected and approved.");
      loadDirectory("").catch(showError);
      return;
    }
    if (response.type === "progress") {
      fields.progress.value = response.offset;
      return;
    }
    const waiter = pending.get(response.request);
    if (!waiter) {
      if (response.type === "error") stop(response.message || "LIVI rejected the connection.");
      return;
    }
    pending.delete(response.request);
    clearTimeout(waiter.timer);
    if (response.type === "error") waiter.reject(new Error(response.message));
    else waiter.resolve(response);
  }

  async function connect() {
    if (!window.isSecureContext || !crypto.subtle) {
      throw new Error("Open this page over HTTPS or localhost.");
    }
    const peerId = peerIdFromLink();
    const code = fields.code.value.trim();
    if (!/^[0-9]{6}$/.test(code)) throw new Error("Enter the six-digit pairing code.");

    fields.connect.disabled = true;
    fields.disconnect.disabled = false;
    fields.verification.hidden = true;
    displayStatus("Connecting to PeerJS...");
    const peer = new Peer(undefined, {
      host: "0.peerjs.com",
      port: 443,
      path: "/",
      secure: true,
      pingInterval: 5000,
      debug: 0,
      ...(config.iceServers?.length ? { config: { iceServers: config.iceServers } } : {}),
    });
    connection = peer;
    peer.on("error", (error) => {
      if (connection === peer) stop(`PeerJS connection failed: ${error.message}`);
    });
    peer.on("open", () => {
      if (connection !== peer) return;
      const data = peer.connect(peerId, {
        label: "livi-music",
        reliable: true,
        serialization: "raw",
      });
      channel = data;
      data.on("open", () => {
        if (connection !== peer) return;
        if (data.dataChannel) data.dataChannel.bufferedAmountLowThreshold = 64 * 1024;
        displayStatus("Connected. Waiting for approval on LIVI.");
        data.send(JSON.stringify({ type: "hello", code }));
      });
      data.on("data", (message) => {
        if (connection === peer) receive(message);
      });
      data.on("close", () => {
        if (connection === peer) stop("The LIVI connection closed.");
      });
      data.on("error", (error) => {
        if (connection === peer) stop(`The LIVI data connection failed: ${error.message}`);
      });
      displayStatus("Connecting to LIVI...");
    });
  }

  function showError(error) {
    fields.message.textContent = error.message;
  }

  function releasePreview() {
    fields.previewAudio.pause();
    fields.previewAudio.removeAttribute("src");
    fields.previewAudio.load();
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    if (artworkUrl) URL.revokeObjectURL(artworkUrl);
    audioUrl = null;
    artworkUrl = null;
    fields.previewArtwork.hidden = true;
    fields.previewPlayer.hidden = true;
    fields.previewPlay.textContent = "Play";
    fields.previewSeek.value = "0";
    fields.previewTime.textContent = "0:00 / 0:00";
  }

  async function previewFile(file) {
    const generation = ++previewGeneration;
    releasePreview();
    fields.preview.hidden = false;
    fields.previewTitle.textContent = file.name;
    fields.previewArtist.textContent = "";
    fields.previewAlbum.textContent = "";
    fields.previewNote.textContent = "";
    const ext = file.name.split(".").pop().toLowerCase();
    const type = audioTypes[ext];
    if (!type) {
      fields.previewNote.textContent = extension.test(file.name)
        ? "Playlist file"
        : "This file is not a supported music or playlist format.";
      return;
    }
    if (fields.previewAudio.canPlayType(type)) {
      audioUrl = URL.createObjectURL(file);
      fields.previewAudio.src = audioUrl;
      fields.previewPlayer.hidden = false;
    } else {
      fields.previewNote.textContent = "This browser cannot play a preview of this format.";
    }
    try {
      if (!window.LIVI_MUSIC_METADATA) throw new Error("Metadata reader is unavailable");
      const metadata = await window.LIVI_MUSIC_METADATA.read(file);
      if (generation !== previewGeneration) return;
      fields.previewTitle.textContent = metadata.title || file.name;
      fields.previewArtist.textContent = metadata.artist || "";
      fields.previewAlbum.textContent = metadata.album || "";
      const picture = metadata.picture;
      if (picture && picture.data.byteLength <= maxArtworkSize
          && ["image/jpeg", "image/png", "image/webp"].includes(picture.format)) {
        artworkUrl = URL.createObjectURL(new Blob([picture.data], { type: picture.format }));
        fields.previewArtwork.src = artworkUrl;
        fields.previewArtwork.hidden = false;
      }
    } catch (error) {
      if (generation !== previewGeneration) return;
      const detail = `Metadata unavailable: ${error.message}`;
      fields.previewNote.textContent = [fields.previewNote.textContent, detail].filter(Boolean).join(" ");
    }
  }

  function updateSelection() {
    const files = [...fields.files.files, ...fields.folder.files];
    previewGeneration++;
    releasePreview();
    fields.selection.hidden = !files.length;
    fields.preview.hidden = true;
    fields.selectionList.replaceChildren();
    fields.selectionCount.textContent = `${files.length} ${files.length === 1 ? "file" : "files"}`;
    for (const file of files.slice(0, 200)) {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = file.webkitRelativePath || file.name;
      button.addEventListener("click", () => previewFile(file).catch(showError));
      item.append(button);
      fields.selectionList.append(item);
    }
    if (files.length > 200) {
      const item = document.createElement("li");
      item.textContent = `Showing the first 200 of ${files.length} selected files.`;
      fields.selectionList.append(item);
    }
    if (files.length) previewFile(files[0]).catch(showError);
  }

  async function loadDirectory(path) {
    if (uploading) return;
    fields.message.textContent = "";
    const entries = [];
    let offset = 0;
    do {
      const page = await request("list", { path, offset });
      entries.push(...page.entries);
      offset = page.next;
    } while (offset !== null);
    currentPath = path;
    fields.location.textContent = `/${path}`;
    fields.entries.replaceChildren();
    if (path) {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.textContent = "Parent folder";
      button.onclick = () => loadDirectory(path.split("/").slice(0, -1).join("/")).catch(showError);
      item.append(button);
      fields.entries.append(item);
    }
    for (const entry of entries) {
      const item = document.createElement("li");
      if (entry.directory) {
        const button = document.createElement("button");
        button.textContent = `Folder: ${entry.name}`;
        button.onclick = () => loadDirectory(path ? `${path}/${entry.name}` : entry.name).catch(showError);
        item.append(button);
      } else {
        item.textContent = entry.name;
      }
      fields.entries.append(item);
    }
    if (!entries.length) {
      const item = document.createElement("li");
      item.textContent = "This folder is empty.";
      fields.entries.append(item);
    }
  }

  async function advanceDigest(previous, chunk) {
    const joined = new Uint8Array(previous.length + chunk.length);
    joined.set(previous);
    joined.set(chunk, previous.length);
    return new Uint8Array(await crypto.subtle.digest("SHA-256", joined));
  }

  function ensureSession(peer) {
    if (!approved || connection !== peer) throw new Error("The connection closed during upload.");
  }

  async function digestPrefix(file, offset, chunkSize, peer) {
    let digest = new Uint8Array(32);
    for (let position = 0; position < offset; position += chunkSize) {
      ensureSession(peer);
      const chunk = new Uint8Array(await file.slice(position, Math.min(position + chunkSize, offset)).arrayBuffer());
      digest = await advanceDigest(digest, chunk);
    }
    return digest;
  }

  async function waitForBuffer(data) {
    while (data.readyState === "open" && data.bufferedAmount > 256 * 1024) {
      await new Promise((resolve) => {
        const timer = setTimeout(done, 100);
        function done() {
          clearTimeout(timer);
          data.removeEventListener("bufferedamountlow", done);
          resolve();
        }
        data.addEventListener("bufferedamountlow", done);
      });
    }
    if (data.readyState !== "open") throw new Error("The connection closed during upload.");
  }

  async function uploadFile(file, path, peer) {
    ensureSession(peer);
    if (!extension.test(path)) throw new Error(`Unsupported file: ${path}`);
    if (file.size > maxFileSize) throw new Error(`File exceeds the 2 GiB limit: ${path}`);
    const begin = () => request("begin", { path, size: file.size, modified: file.lastModified });
    let ready = await begin();
    ensureSession(peer);
    let digest = await digestPrefix(file, ready.offset, ready.chunkSize, peer);
    ensureSession(peer);
    if (toHex(digest) !== ready.digest) {
      await request("discard");
      ensureSession(peer);
      ready = await begin();
      ensureSession(peer);
      digest = new Uint8Array(32);
      fields.message.textContent = `The saved partial copy of ${path} differed; restarting it.`;
    }
    fields.progressArea.hidden = false;
    fields.progress.max = Math.max(file.size, 1);
    fields.progress.value = ready.offset;
    fields.progressLabel.textContent = path;
    const data = channel?.dataChannel;
    if (!data) throw new Error("The LIVI data connection is not ready.");
    for (let offset = ready.offset; offset < file.size; offset += ready.chunkSize) {
      const chunk = new Uint8Array(await file.slice(offset, offset + ready.chunkSize).arrayBuffer());
      digest = await advanceDigest(digest, chunk);
      ensureSession(peer);
      await waitForBuffer(data);
      data.send(chunk);
    }
    ensureSession(peer);
    await request("finish", { digest: toHex(digest) });
    fields.progress.value = Math.max(file.size, 1);
  }

  async function upload() {
    const selected = [...fields.files.files, ...fields.folder.files];
    if (!selected.length) throw new Error("Choose files or a folder first.");
    const destination = currentPath;
    const peer = connection;
    const generation = ++uploadGeneration;
    uploading = true;
    fields.upload.disabled = true;
    fields.refresh.disabled = true;
    fields.files.disabled = true;
    fields.folder.disabled = true;
    fields.message.textContent = "";
    let succeeded = 0;
    const failures = [];
    for (const file of selected) {
      const relative = file.webkitRelativePath || file.name;
      const path = destination ? `${destination}/${relative}` : relative;
      try {
        await uploadFile(file, path, peer);
        succeeded++;
      } catch (error) {
        failures.push(`${path}: ${error.message}`);
        if (!approved || connection !== peer) break;
      }
    }
    if (uploadGeneration !== generation) return;
    uploading = false;
    fields.upload.disabled = false;
    fields.refresh.disabled = false;
    fields.files.disabled = false;
    fields.folder.disabled = false;
    if (approved && connection === peer) {
      await loadDirectory(destination);
      fields.message.textContent = `Uploaded ${succeeded} of ${selected.length} files.${failures.length ? ` ${failures.join(" ")}` : ""}`;
    }
  }

  fields.form.addEventListener("submit", (event) => {
    event.preventDefault();
    connect().catch((error) => stop(error.message));
  });
  fields.disconnect.addEventListener("click", () => stop("Disconnected."));
  fields.refresh.addEventListener("click", () => loadDirectory(currentPath).catch(showError));
  fields.upload.addEventListener("click", () => upload().catch(showError));
  fields.files.addEventListener("change", updateSelection);
  fields.folder.addEventListener("change", updateSelection);
  fields.previewAudio.addEventListener("error", () => {
    fields.previewNote.textContent = "This browser could not play the preview; the file can still be uploaded.";
  });
  fields.previewPlay.addEventListener("click", async () => {
    try {
      if (fields.previewAudio.paused) await fields.previewAudio.play();
      else fields.previewAudio.pause();
    } catch (error) {
      fields.previewNote.textContent = `Unable to play the preview: ${error.message}`;
    }
  });
  fields.previewAudio.addEventListener("play", () => { fields.previewPlay.textContent = "Pause"; });
  fields.previewAudio.addEventListener("pause", () => { fields.previewPlay.textContent = "Play"; });
  fields.previewAudio.addEventListener("timeupdate", () => {
    const audio = fields.previewAudio;
    const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
    const format = (seconds) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
    fields.previewSeek.value = duration ? String(audio.currentTime / duration) : "0";
    fields.previewTime.textContent = `${format(audio.currentTime)} / ${format(duration)}`;
  });
  fields.previewSeek.addEventListener("input", () => {
    if (Number.isFinite(fields.previewAudio.duration)) {
      fields.previewAudio.currentTime = Number(fields.previewSeek.value) * fields.previewAudio.duration;
    }
  });
  window.addEventListener("pagehide", releasePreview);
})();
