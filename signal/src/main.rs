// SPDX-FileCopyrightText: 2026 LIVI contributors
// SPDX-License-Identifier: GPL-3.0-or-later

use std::collections::{HashMap, VecDeque};
use std::net::{IpAddr, SocketAddr};
use std::sync::Arc;
use std::time::{Duration, Instant};

use axum::Router;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{ConnectInfo, State};
use axum::response::IntoResponse;
use axum::routing::get;
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use tokio::sync::{Mutex, mpsc};

const MAX_MESSAGE: usize = 64 * 1024;
const MAX_ROOMS: usize = 512;
const ATTEMPTS_PER_MINUTE: usize = 30;
const MAX_CLIENTS: usize = 4096;
const ROOM_LIFETIME: Duration = Duration::from_secs(30 * 60);

#[derive(Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum Role {
    Device,
    Browser,
}

#[derive(Deserialize)]
struct Join {
    role: Role,
    code: String,
}

#[derive(Deserialize, Serialize)]
struct Signal {
    #[serde(rename = "type")]
    kind: String,
    sdp: String,
}

struct Room {
    device: mpsc::Sender<String>,
    browser: Option<mpsc::Sender<String>>,
    id: u64,
}

#[derive(Default)]
struct Rooms {
    rooms: HashMap<String, Room>,
    attempts: HashMap<IpAddr, VecDeque<Instant>>,
    next_id: u64,
}

type Shared = Arc<Mutex<Rooms>>;

async fn upgrade(
    State(shared): State<Shared>,
    ConnectInfo(address): ConnectInfo<SocketAddr>,
    ws: WebSocketUpgrade,
) -> impl IntoResponse {
    ws.max_message_size(MAX_MESSAGE)
        .max_frame_size(MAX_MESSAGE)
        .on_upgrade(move |socket| session(socket, shared, address.ip()))
}

fn valid_code(code: &str) -> bool {
    code.len() == 6 && code.bytes().all(|byte| byte.is_ascii_digit())
}

fn permit(state: &mut Rooms, ip: IpAddr, now: Instant) -> bool {
    state.attempts.retain(|_, attempts| {
        while attempts
            .front()
            .is_some_and(|time| now.duration_since(*time) >= Duration::from_secs(60))
        {
            attempts.pop_front();
        }
        !attempts.is_empty()
    });
    if !state.attempts.contains_key(&ip) && state.attempts.len() >= MAX_CLIENTS {
        return false;
    }
    let attempts = state.attempts.entry(ip).or_default();
    if attempts.len() >= ATTEMPTS_PER_MINUTE {
        return false;
    }
    attempts.push_back(now);
    true
}

async fn fail(socket: &mut WebSocket, reason: &str) {
    let text = serde_json::json!({ "type": "error", "message": reason }).to_string();
    if let Err(error) = socket.send(Message::Text(text.into())).await {
        eprintln!("[music-signal] cannot report connection error: {error}");
    }
    let _ = socket.close().await;
}

async fn session(mut socket: WebSocket, shared: Shared, ip: IpAddr) {
    {
        let mut state = shared.lock().await;
        if !permit(&mut state, ip, Instant::now()) {
            drop(state);
            fail(&mut socket, "Too many connection attempts; try again later").await;
            return;
        }
    }
    let join = match tokio::time::timeout(Duration::from_secs(10), socket.next()).await {
        Ok(Some(Ok(Message::Text(text)))) if text.len() <= 1024 => {
            serde_json::from_str::<Join>(&text).ok()
        }
        _ => None,
    };
    let Some(join) = join.filter(|join| valid_code(&join.code)) else {
        fail(&mut socket, "Invalid pairing request").await;
        return;
    };

    let (out, mut incoming) = mpsc::channel::<String>(8);
    let (id, other) = {
        let mut state = shared.lock().await;
        match join.role {
            Role::Device => {
                if state.rooms.contains_key(&join.code) || state.rooms.len() >= MAX_ROOMS {
                    drop(state);
                    fail(&mut socket, "Pairing code is unavailable; start again").await;
                    return;
                }
                state.next_id = state.next_id.wrapping_add(1);
                let id = state.next_id;
                state.rooms.insert(
                    join.code.clone(),
                    Room {
                        device: out.clone(),
                        browser: None,
                        id,
                    },
                );
                (id, None)
            }
            Role::Browser => {
                let Some(room) = state.rooms.get_mut(&join.code) else {
                    drop(state);
                    fail(&mut socket, "Pairing code not found or expired").await;
                    return;
                };
                if room.browser.is_some() {
                    drop(state);
                    fail(&mut socket, "This pairing session already has a browser").await;
                    return;
                }
                room.browser = Some(out.clone());
                (room.id, Some(room.device.clone()))
            }
        }
    };
    if socket
        .send(Message::Text(r#"{"type":"joined"}"#.into()))
        .await
        .is_err()
    {
        remove(&shared, &join.code, id, join.role).await;
        return;
    }
    if let Some(other) = other
        && other.send(r#"{"type":"peer"}"#.into()).await.is_err()
    {
        remove(&shared, &join.code, id, join.role).await;
        fail(&mut socket, "LIVI disconnected").await;
        return;
    }

    let deadline = tokio::time::sleep(ROOM_LIFETIME);
    tokio::pin!(deadline);
    loop {
        tokio::select! {
            _ = &mut deadline => break,
            outgoing = incoming.recv() => {
                let Some(outgoing) = outgoing else { break };
                if socket.send(Message::Text(outgoing.into())).await.is_err() { break; }
            }
            received = socket.next() => {
                let Some(Ok(message)) = received else { break };
                match message {
                    Message::Text(text) => {
                        let Ok(signal) = serde_json::from_str::<Signal>(&text) else {
                            fail(&mut socket, "Invalid signaling message").await;
                            break;
                        };
                        let expected = if join.role == Role::Browser { "offer" } else { "answer" };
                        if signal.kind != expected || signal.sdp.len() > MAX_MESSAGE - 1024 {
                            fail(&mut socket, "Unexpected signaling message").await;
                            break;
                        }
                        let peer = {
                            let state = shared.lock().await;
                            state.rooms.get(&join.code).and_then(|room| {
                                if room.id != id { None }
                                else if join.role == Role::Browser { Some(room.device.clone()) }
                                else { room.browser.clone() }
                            })
                        };
                        let Some(peer) = peer else { break };
                        if peer.send(text.to_string()).await.is_err() { break; }
                    }
                    Message::Ping(payload) => {
                        if socket.send(Message::Pong(payload)).await.is_err() { break; }
                    }
                    Message::Pong(_) => {}
                    Message::Close(_) => break,
                    Message::Binary(_) => {
                        fail(&mut socket, "Binary signaling messages are not allowed").await;
                        break;
                    }
                }
            }
        }
    }
    if let Some(peer) = remove(&shared, &join.code, id, join.role).await {
        let _ = peer.try_send(r#"{"type":"peer-left"}"#.into());
    }
}

async fn remove(shared: &Shared, code: &str, id: u64, role: Role) -> Option<mpsc::Sender<String>> {
    let mut state = shared.lock().await;
    if state.rooms.get(code).is_none_or(|room| room.id != id) {
        return None;
    }
    let room = state.rooms.remove(code)?;
    match role {
        Role::Device => room.browser,
        Role::Browser => Some(room.device),
    }
}

// Container platforms (Fly.io, Render, Cloud Run) announce the port via `PORT`.
fn listen_address(listen: Option<String>, port: Option<String>) -> String {
    listen
        .or_else(|| port.map(|port| format!("0.0.0.0:{port}")))
        .unwrap_or_else(|| "127.0.0.1:8787".into())
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let address = listen_address(
        std::env::var("LIVI_MUSIC_SIGNAL_LISTEN").ok(),
        std::env::var("PORT").ok(),
    );
    let listener = tokio::net::TcpListener::bind(&address).await?;
    let app = Router::new()
        .route("/signal", get(upgrade))
        .route("/healthz", get(|| async { "ok" }))
        .with_state(Arc::new(Mutex::new(Rooms::default())));
    eprintln!("[music-signal] listening on {}", listener.local_addr()?);
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn limits_attempts_and_expires_the_window() {
        let mut state = Rooms::default();
        let address = "127.0.0.1".parse().unwrap();
        let now = Instant::now();
        for _ in 0..ATTEMPTS_PER_MINUTE {
            assert!(permit(&mut state, address, now));
        }
        assert!(!permit(&mut state, address, now));
        assert!(permit(&mut state, address, now + Duration::from_secs(60)));
        assert!(valid_code("004201"));
        assert!(!valid_code("٤٤٤٤٤٤"));
    }

    #[test]
    fn explicit_listen_address_wins_over_port() {
        assert_eq!(listen_address(None, None), "127.0.0.1:8787");
        assert_eq!(listen_address(None, Some("8080".into())), "0.0.0.0:8080");
        assert_eq!(
            listen_address(Some("[::]:9000".into()), Some("8080".into())),
            "[::]:9000"
        );
    }
}
