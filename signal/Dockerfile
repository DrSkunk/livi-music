FROM rust:1-alpine AS build
RUN apk add --no-cache musl-dev
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN cargo build --release --locked

FROM scratch
COPY --from=build /src/target/release/livi-music-signal /livi-music-signal
ENV LIVI_MUSIC_SIGNAL_LISTEN=0.0.0.0:8787
EXPOSE 8787
USER 65534:65534
ENTRYPOINT ["/livi-music-signal"]
