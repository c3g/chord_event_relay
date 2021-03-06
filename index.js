#!/usr/bin/env node

// Small service to forward events from Redis PubSub to socket.io connections
// (e.g. a JavaScript front-end.)
// Author: David Lougheed <david.lougheed@mail.mcgill.ca>
// Copyright: Canadian Centre for Computational Genomics, 2019-2021

const http = require("http");
const redis = require("redis");
const socketIO = require("socket.io");

const pj = require("./package");

const parseIntIfInt = v => v && v.toString().match(/^\d+$/) ? parseInt(v, 10) : v;

const SERVICE_TYPE = `ca.c3g.bento:event-relay:${pj.version}`;
const SERVICE_ID = process.env.SERVICE_ID || SERVICE_TYPE;

const SERVICE_INFO = {
    "id": SERVICE_ID,
    "name": "Bento Event Relay",
    "type": SERVICE_TYPE,
    "description": "Event relay from Redis PubSub events to socket.io.",
    "organization": {
        "name": "C3G",
        "url": "https://www.computationalgenomics.ca/"
    },
    "contactUrl": "mailto:david.lougheed@mail.mcgill.ca",
    "version": pj.version
};

const JSON_MESSAGES = (process.env.JSON_MESSAGES || "true").trim().toLocaleLowerCase() === "true";
const REDIS_CONNECTION = process.env.REDIS_CONNECTION;
const REDIS_SUBSCRIBE_PATTERN = process.env.REDIS_SUBSCRIBE_PATTERN || "chord.*";
const SERVICE_URL_BASE_PATH = process.env.SERVICE_URL_BASE_PATH || "";
const SOCKET_IO_PATH = process.env.SOCKET_IO_PATH || "/socket.io";

// Listen on a port or socket file if specified; default to 8080 if not
// Also check SERVICE_SOCKET, where chord_singularity passes pre-set socket paths to services
const SERVICE_LISTEN_ON = parseIntIfInt(process.env.SERVICE_LISTEN_ON || process.env.SERVICE_SOCKET || 8080);


const app = http.createServer((req, res) => {
    // Only respond to /service-info requests (to be CHORD-compatible)
    if (req.url === `${SERVICE_URL_BASE_PATH}/service-info`) {
        res.writeHead(200, {"Content-Type": "application/json"});
        res.end(JSON.stringify(SERVICE_INFO));
        return;
    }

    res.writeHead(404);
    res.end();
});

const io = new socketIO.Server(app, {
    path: `${SERVICE_URL_BASE_PATH}${SOCKET_IO_PATH}`,
    serveClient: false,
});

// Create a pub-sub client to listen for events
const client = redis.createClient(REDIS_CONNECTION || {});

// Forward any message received to all currently-open socket.io connections
client.on("pmessage", (pattern, channel, message) => {
    // TODO: Filter message type in relay
    for (const socket of io.of("/").sockets.values()) {
        try {
            // Include channel in message data, since otherwise the information is lost on the receiving end.
            // If we're in "generic mode" (i.e. JSON_MESSAGES is false) then the message is passed as the single key in
            // an event object; otherwise, pass the deserialized data.
            socket.emit("events", {message: JSON_MESSAGES ? JSON.parse(message) : message, channel});
        } catch (e) {
            console.error(`Encountered error while relaying message: ${e} (pattern: ${pattern}, channel: ${
                channel}, message: ${message})`);
        }
    }
});

// Subscribe to all incoming messages
client.psubscribe(REDIS_SUBSCRIBE_PATTERN);

// Listen on a socket file or port
app.listen(SERVICE_LISTEN_ON);
console.log(`bento_event_relay listening on ${SERVICE_LISTEN_ON}`);

// Properly shut down (thus cleaning up any open socket files) when a signal is received
const shutdown = () => app.close(() => process.exit());
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
