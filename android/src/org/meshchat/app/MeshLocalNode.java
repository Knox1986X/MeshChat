// Встроенный локальный и Wi-Fi Mesh слепой узел MeshChat внутри Android-приложения.
// Решает сразу три задачи без внешних облачных сервисов:
//   1. Раздаёт встроенный веб-клиент из APK по безопасному origin http://127.0.0.1:17701
//      (полная поддержка WebCrypto extractable=false, Web Workers, Argon2id WASM и IndexedDB).
//   2. Реализует полный протокол слепого ретранслятора MeshChat (Zero-Knowledge ECDSA P-256 вход,
//      ящики Sealed Sender, одноразовые блобы, сигналинг WebRTC) — при включении режима
//      "Wi-Fi Mesh (:3000)" соседние телефоны в одной Wi-Fi сети или точке доступа общаются
//      напрямую через Signal Protocol вообще без интернета!
//   3. При указании скрытого адреса .onion прозрачно туннелирует HTTP /api/* через Orbot SOCKS5.

package org.meshchat.app;

import android.content.ContentResolver;
import android.content.Context;
import android.content.pm.PackageInfo;
import android.content.res.AssetFileDescriptor;
import android.content.res.AssetManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.Build;
import android.util.Base64;
import android.util.Size;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URI;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.MessageDigest;
import java.security.PublicKey;
import java.security.SecureRandom;
import java.security.Signature;
import java.security.spec.X509EncodedKeySpec;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Enumeration;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArraySet;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

public final class MeshLocalNode {
    // Выделенный порт io.meshchat.app (исключает перехват старым процессом org.meshchat.app на 17701)
    public static final int LOCAL_PORT = 27701;
    public static final int LAN_MESH_PORT = 3000;

    private static final String WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
    private static final byte PROTOCOL_MAGIC = 0x56;

    // Фиксированный ASN.1 DER заголовок SubjectPublicKeyInfo для 65-байтного ключа P-256 (secp256r1)
    private static final byte[] P256_SPKI_PREFIX = new byte[]{
            0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, (byte) 0x86, 0x48, (byte) 0xce, 0x3d, 0x02, 0x01,
            0x06, 0x08, 0x2a, (byte) 0x86, 0x48, (byte) 0xce, 0x3d, 0x03, 0x01, 0x07, 0x03, 0x42, 0x00
    };

    private final Context appContext;
    private final AssetManager assets;
    private final File nodeDir;
    private final File blobsDir;
    private final File usersFile;
    private final SecureRandom rng = new SecureRandom();
    private final byte[] powSecret = new byte[32];
    private final byte[] synthSecret = new byte[32];
    private final String localRefSecret;
    private final ExecutorService pool = Executors.newCachedThreadPool();

    private ServerSocket loopbackServer;
    private ServerSocket lanMeshServer;
    private volatile int boundPort = LOCAL_PORT;
    private volatile boolean running = false;
    private volatile boolean lanRunning = false;
    private volatile String upstreamOnionOrigin = "";

    // Слепые структуры хранения (без паролей, без открытых сообщений, без IP)
    private final Map<String, JSONObject> usersById = new ConcurrentHashMap<>();
    private final Map<String, String> userIdByName = new ConcurrentHashMap<>();
    private final Map<String, String> userIdByMailbox = new ConcurrentHashMap<>();
    private final Map<String, String> sessions = new ConcurrentHashMap<>(); // token -> userId
    private final Map<String, ChallengeItem> challenges = new ConcurrentHashMap<>();
    private final Map<String, List<EnvelopeItem>> mailboxes = new ConcurrentHashMap<>();
    private final Map<String, List<JSONObject>> asksByMailbox = new ConcurrentHashMap<>();
    private final Map<String, Set<String>> blockedAskTags = new ConcurrentHashMap<>();
    private final Map<String, BlobMeta> blobIndex = new ConcurrentHashMap<>();
    private final Map<String, Set<WsPeer>> onlineByMailbox = new ConcurrentHashMap<>();

    private static final class ChallengeItem {
        final String username;
        final long expiresAt;
        ChallengeItem(String u, long exp) { this.username = u; this.expiresAt = exp; }
    }

    private static final class EnvelopeItem {
        final String id;
        final byte[] sealedBytes;
        final long expiresAt;
        EnvelopeItem(String id, byte[] b, long exp) { this.id = id; this.sealedBytes = b; this.expiresAt = exp; }
    }

    private static final class BlobMeta {
        final String id;
        final boolean once;
        final String burnTokenHash;
        final int size;
        BlobMeta(String id, boolean once, String burnHash, int size) {
            this.id = id; this.once = once; this.burnTokenHash = burnHash; this.size = size;
        }
    }

    public MeshLocalNode(Context context) {
        this.appContext = context.getApplicationContext();
        this.assets = this.appContext.getAssets();
        this.nodeDir = new File(this.appContext.getFilesDir(), "mesh_node");
        this.blobsDir = new File(this.nodeDir, "blobs");
        this.usersFile = new File(this.nodeDir, "blind_users.json");
        this.nodeDir.mkdirs();
        this.blobsDir.mkdirs();
        rng.nextBytes(powSecret);
        rng.nextBytes(synthSecret);
        this.localRefSecret = randB64Url(24);
        loadPersistedUsers();
    }

    public String getLocalRefSecret() {
        return localRefSecret;
    }

    public synchronized void startLoopback() {
        if (running && loopbackServer != null && !loopbackServer.isClosed()) return;
        for (int candidate = LOCAL_PORT; candidate <= LOCAL_PORT + 14; candidate++) {
            try {
                ServerSocket srv = new ServerSocket();
                srv.setReuseAddress(true);
                srv.bind(new InetSocketAddress(InetAddress.getByName("127.0.0.1"), candidate), 64);
                loopbackServer = srv;
                boundPort = candidate;
                running = true;
                pool.execute(() -> acceptLoop(loopbackServer, false));
                return;
            } catch (IOException ignored) {
                // Если порт занят фоновым процессом — переходим к следующему свободному порту
            }
        }
    }

    public int getBoundPort() {
        return boundPort;
    }

    public synchronized boolean setLanMeshEnabled(boolean enable) {
        if (enable && !lanRunning) {
            try {
                lanMeshServer = new ServerSocket(LAN_MESH_PORT, 64, InetAddress.getByName("0.0.0.0"));
                lanRunning = true;
                pool.execute(() -> acceptLoop(lanMeshServer, true));
            } catch (IOException e) {
                lanRunning = false;
            }
        } else if (!enable && lanRunning) {
            lanRunning = false;
            try {
                if (lanMeshServer != null) lanMeshServer.close();
            } catch (IOException ignored) {
            }
            lanMeshServer = null;
        }
        return lanRunning;
    }

    public boolean isLanMeshRunning() {
        return lanRunning;
    }

    public void setUpstreamServer(String url) {
        String clean = url == null ? "" : url.trim();
        if (clean.contains(".onion")) {
            if (!clean.startsWith("http://") && !clean.startsWith("https://")) {
                clean = "http://" + clean;
            }
            this.upstreamOnionOrigin = clean.replaceAll("/+$", "");
        } else {
            this.upstreamOnionOrigin = "";
        }
    }

    public String detectLanUrl() {
        try {
            Enumeration<NetworkInterface> ifaces = NetworkInterface.getNetworkInterfaces();
            while (ifaces != null && ifaces.hasMoreElements()) {
                NetworkInterface nif = ifaces.nextElement();
                if (!nif.isUp() || nif.isLoopback()) continue;
                Enumeration<InetAddress> addrs = nif.getInetAddresses();
                while (addrs.hasMoreElements()) {
                    InetAddress addr = addrs.nextElement();
                    if (addr instanceof Inet4Address && !addr.isLoopbackAddress()) {
                        return "http://" + addr.getHostAddress() + ":" + LAN_MESH_PORT;
                    }
                }
            }
        } catch (Exception ignored) {
        }
        return "http://0.0.0.0:" + LAN_MESH_PORT;
    }

    public synchronized void stopAll() {
        running = false;
        lanRunning = false;
        try { if (loopbackServer != null) loopbackServer.close(); } catch (IOException ignored) {}
        try { if (lanMeshServer != null) lanMeshServer.close(); } catch (IOException ignored) {}
    }

    private void acceptLoop(ServerSocket srv, boolean isLan) {
        while ((isLan && lanRunning) || (!isLan && running)) {
            try {
                final Socket sock = srv.accept();
                pool.execute(() -> handleHttpOrWs(sock));
            } catch (IOException e) {
                break;
            }
        }
    }

    private void handleHttpOrWs(Socket sock) {
        try {
            sock.setSoTimeout(30000);
            InputStream in = sock.getInputStream();
            OutputStream out = sock.getOutputStream();

            String headerBlock = MeshSocksBridge.readHttpHeaderBlock(in);
            if (headerBlock == null || headerBlock.isEmpty()) {
                sock.close();
                return;
            }

            String[] lines = headerBlock.split("\r\n");
            String[] reqLine = lines[0].split(" ");
            if (reqLine.length < 2) {
                sock.close();
                return;
            }
            String method = reqLine[0].toUpperCase(Locale.ROOT);
            URI uri = URI.create("http://localhost" + reqLine[1]);
            String path = uri.getPath() == null ? "/" : uri.getPath();

            Map<String, String> headers = new HashMap<>();
            for (int i = 1; i < lines.length; i++) {
                int idx = lines[i].indexOf(':');
                if (idx > 0) {
                    headers.put(
                            lines[i].substring(0, idx).trim().toLowerCase(Locale.ROOT),
                            lines[i].substring(idx + 1).trim()
                    );
                }
            }

            if ("OPTIONS".equals(method)) {
                sendRawResponse(out, 204, "text/plain", new byte[0], true);
                sock.close();
                return;
            }

            // Рукопожатие RFC 6455 WebSocket (/ws)
            if ("/ws".equals(path) && "websocket".equalsIgnoreCase(headers.get("upgrade"))) {
                String wsKey = headers.get("sec-websocket-key");
                if (wsKey == null) {
                    sock.close();
                    return;
                }
                MessageDigest sha1 = MessageDigest.getInstance("SHA-1");
                String accept = Base64.encodeToString(
                        sha1.digest((wsKey + WS_GUID).getBytes(StandardCharsets.UTF_8)),
                        Base64.NO_WRAP
                );
                String hs = "HTTP/1.1 101 Switching Protocols\r\n"
                        + "Upgrade: websocket\r\n"
                        + "Connection: Upgrade\r\n"
                        + "Sec-WebSocket-Accept: " + accept + "\r\n\r\n";
                out.write(hs.getBytes(StandardCharsets.UTF_8));
                out.flush();
                sock.setSoTimeout(0);
                runWebSocketSession(new WsPeer(sock, in, out));
                return;
            }

            int contentLen = 0;
            if (headers.containsKey("content-length")) {
                contentLen = Math.min(52 * 1024 * 1024, Math.max(0, Integer.parseInt(headers.get("content-length"))));
            }
            byte[] reqBody = contentLen > 0 ? MeshSocksBridge.readExact(in, contentLen) : new byte[0];

            if (path.startsWith("/api/")) {
                // Если пользователь выбрал внешний .onion-сервер, проксируем HTTP /api/* через Orbot SOCKS5
                if (!upstreamOnionOrigin.isEmpty()) {
                    proxyApiOverOrbot(method, reqLine[1], headers, reqBody, out);
                } else {
                    handleLocalApi(method, path, headers, reqBody, out);
                }
                sock.close();
                return;
            }

            // Локальный потоковый мост без создания копий файлов (строго только с 127.0.0.1 + секретный токен сессии)
            if ("/local-ref".equals(path)) {
                if (sock.getInetAddress() != null && sock.getInetAddress().isLoopbackAddress()) {
                    serveLocalContentUri(method, uri.getRawQuery(), headers, out);
                } else {
                    sendRawResponse(out, 403, "text/plain; charset=utf-8", "Forbidden".getBytes(StandardCharsets.UTF_8), false);
                }
                sock.close();
                return;
            }

            // Раздача статических модулей клиента из упакованных assets/www APK
            serveStaticAsset(method, path, out);
            sock.close();
        } catch (Exception e) {
            try { sock.close(); } catch (IOException ignored) {}
        }
    }

    private void proxyApiOverOrbot(String method, String rawTarget, Map<String, String> headers, byte[] body, OutputStream clientOut) throws IOException {
        URI u = URI.create(upstreamOnionOrigin);
        String host = u.getHost();
        int port = u.getPort() > 0 ? u.getPort() : 80;
        try (Socket torSock = MeshSocksBridge.openSocks5Tunnel(host, port, MeshSocksBridge.TOR_PORTS)) {
            torSock.setSoTimeout(25000);
            OutputStream upOut = torSock.getOutputStream();
            InputStream upIn = torSock.getInputStream();

            StringBuilder sb = new StringBuilder();
            sb.append(method).append(" ").append(rawTarget).append(" HTTP/1.1\r\n");
            sb.append("Host: ").append(host).append("\r\n");
            sb.append("Connection: close\r\n");
            sb.append("X-Veil-Transport: tor\r\n");
            if (headers.containsKey("content-type")) sb.append("Content-Type: ").append(headers.get("content-type")).append("\r\n");
            if (headers.containsKey("authorization")) sb.append("Authorization: ").append(headers.get("authorization")).append("\r\n");
            if (headers.containsKey("x-veil-once")) sb.append("X-Veil-Once: ").append(headers.get("x-veil-once")).append("\r\n");
            if (headers.containsKey("x-veil-burn-token")) sb.append("X-Veil-Burn-Token: ").append(headers.get("x-veil-burn-token")).append("\r\n");
            sb.append("Content-Length: ").append(body.length).append("\r\n\r\n");

            upOut.write(sb.toString().getBytes(StandardCharsets.UTF_8));
            if (body.length > 0) upOut.write(body);
            upOut.flush();

            byte[] buf = new byte[16384];
            int n;
            while ((n = upIn.read(buf)) >= 0) {
                clientOut.write(buf, 0, n);
            }
            clientOut.flush();
        } catch (Exception err) {
            sendJson(clientOut, 502, errorJson("Не удалось связаться с .onion узлом через Orbot: " + err.getMessage()));
        }
    }

    private void handleLocalApi(String method, String path, Map<String, String> headers, byte[] body, OutputStream out) throws Exception {
        if ("/api/health".equals(path)) {
            JSONObject res = new JSONObject();
            res.put("ok", true);
            res.put("app", "MeshChat Android Node");
            res.put("lanMeshRunning", lanRunning);
            JSONObject tr = new JSONObject();
            tr.put("ws", true);
            tr.put("onion", JSONObject.NULL);
            tr.put("i2p", JSONObject.NULL);
            res.put("transports", tr);
            sendJson(out, 200, res);
            return;
        }

        if ("/api/version".equals(path)) {
            String verName = "1.4.0";
            int verCode = 5;
            try {
                PackageInfo pi = appContext.getPackageManager().getPackageInfo(appContext.getPackageName(), 0);
                if (pi.versionName != null) verName = pi.versionName;
                verCode = pi.versionCode;
            } catch (Exception ignored) {}
            JSONObject res = new JSONObject();
            res.put("ok", true);
            res.put("app", "MeshChat");
            res.put("version", verName);
            res.put("versionCode", verCode);
            res.put("apkAvailable", false);
            res.put("githubRepo", "Knox1986X/MeshChat");
            sendJson(out, 200, res);
            return;
        }

        if ("POST".equals(method) && "/api/auth/pow".equals(path)) {
            JSONObject req = parseBodyJson(body);
            String purpose = "ask".equals(req.optString("purpose")) ? "ask" : "register";
            sendJson(out, 200, issuePow(purpose));
            return;
        }

        if ("POST".equals(method) && "/api/auth/register".equals(path)) {
            JSONObject req = parseBodyJson(body);
            String uname = req.optString("username", "").trim().replaceFirst("^@", "").toLowerCase(Locale.ROOT);
            if (!uname.matches("^[a-z][a-z0-9_]{2,31}$")) {
                sendJson(out, 400, errorJson("Имя пользователя: 3–32 символа латиницей/цифрами"));
                return;
            }
            if (!verifyPow(req.optString("powChallenge"), req.optString("powNonce"), "register")) {
                sendJson(out, 400, errorJson("Некорректное решение Proof-of-Work"));
                return;
            }
            if (userIdByName.containsKey(uname)) {
                sendJson(out, 409, errorJson("Это имя пользователя уже занято"));
                return;
            }
            JSONObject bundle = req.optJSONObject("publicBundle");
            JSONObject identity = bundle != null ? bundle.optJSONObject("identity") : null;
            if (identity == null || !req.has("authPubB64") || !req.has("encryptedAuthKey")) {
                sendJson(out, 400, errorJson("Отсутствуют публичные ключи X3DH / ZK-Auth"));
                return;
            }
            String userId = identity.optString("userId", "");
            String mailboxId = "mb_" + randB64Url(16);
            String writeToken = randB64Url(24);

            JSONObject user = new JSONObject();
            user.put("id", userId);
            user.put("username", uname);
            user.put("mailboxId", mailboxId);
            user.put("mailboxWriteToken", writeToken);
            user.put("authPubB64", req.getString("authPubB64"));
            user.put("encryptedAuthKey", req.getJSONObject("encryptedAuthKey"));
            user.put("identity", identity);
            user.put("signedPreKey", bundle.getJSONObject("signedPreKey"));
            user.put("oneTimePreKeys", bundle.optJSONArray("oneTimePreKeys") != null ? bundle.getJSONArray("oneTimePreKeys") : new JSONArray());
            user.put("encryptedRecovery", req.opt("encryptedRecovery"));
            user.put("askSalt", randB64Url(16));
            user.put("askEnabled", true);

            usersById.put(userId, user);
            userIdByName.put(uname, userId);
            userIdByMailbox.put(mailboxId, userId);
            persistUsers();

            String token = randB64Url(32);
            sessions.put(token, userId);

            JSONObject res = new JSONObject();
            res.put("userId", userId);
            res.put("username", uname);
            res.put("mailboxId", mailboxId);
            res.put("mailboxWriteToken", writeToken);
            res.put("token", token);
            sendJson(out, 200, res);
            return;
        }

        if ("POST".equals(method) && "/api/auth/challenge".equals(path)) {
            JSONObject req = parseBodyJson(body);
            String uname = req.optString("username", "").trim().replaceFirst("^@", "").toLowerCase(Locale.ROOT);
            String nonce = randB64Url(24);
            challenges.put(nonce, new ChallengeItem(uname, System.currentTimeMillis() + 120_000L));

            String uid = userIdByName.get(uname);
            JSONObject encKey = uid != null ? usersById.get(uid).getJSONObject("encryptedAuthKey") : buildSyntheticAuthKey(uname);

            JSONObject res = new JSONObject();
            res.put("challengeNonce", nonce);
            res.put("encryptedAuthKey", encKey);
            sendJson(out, 200, res);
            return;
        }

        if ("POST".equals(method) && "/api/auth/login".equals(path)) {
            JSONObject req = parseBodyJson(body);
            String uname = req.optString("username", "").trim().replaceFirst("^@", "").toLowerCase(Locale.ROOT);
            String nonce = req.optString("challengeNonce", "");
            String sigB64 = req.optString("signatureB64", "");

            ChallengeItem ch = challenges.remove(nonce);
            String uid = userIdByName.get(uname);
            if (ch == null || ch.expiresAt < System.currentTimeMillis() || !ch.username.equals(uname) || uid == null) {
                sendJson(out, 401, errorJson("Неверное имя пользователя или пароль"));
                return;
            }
            JSONObject user = usersById.get(uid);
            byte[] msg = ("MSG-ZK-LOGIN-v1:" + uname + ":" + nonce).getBytes(StandardCharsets.UTF_8);
            if (!verifyP256Ecdsa(fromB64Url(user.getString("authPubB64")), msg, fromB64Url(sigB64))) {
                sendJson(out, 401, errorJson("Неверное имя пользователя или пароль"));
                return;
            }
            String token = randB64Url(32);
            sessions.put(token, uid);

            JSONObject res = new JSONObject();
            res.put("userId", uid);
            res.put("username", uname);
            res.put("mailboxId", user.getString("mailboxId"));
            res.put("mailboxWriteToken", user.getString("mailboxWriteToken"));
            res.put("token", token);
            res.put("encryptedRecovery", user.opt("encryptedRecovery"));
            sendJson(out, 200, res);
            return;
        }

        if ("POST".equals(method) && "/api/blob".equals(path)) {
            String authHdr = headers.getOrDefault("authorization", "").replaceFirst("(?i)^Bearer\\s+", "");
            if (!sessions.containsKey(authHdr)) {
                sendJson(out, 401, errorJson("Требуется авторизация сессии"));
                return;
            }
            boolean once = "1".equals(headers.get("x-veil-once"));
            String blobId = "b_" + bytesToHex(randBytes(16));
            String burnToken = once ? randB64Url(24) : null;
            String burnHash = once ? sha256B64Url(burnToken.getBytes(StandardCharsets.UTF_8)) : null;

            File target = new File(blobsDir, blobId);
            try (FileOutputStream fos = new FileOutputStream(target)) {
                fos.write(body);
            }
            blobIndex.put(blobId, new BlobMeta(blobId, once, burnHash, body.length));

            JSONObject res = new JSONObject();
            res.put("blobId", blobId);
            res.put("size", body.length);
            res.put("sha256B64", sha256B64Url(body));
            res.put("once", once);
            if (once) res.put("burnToken", burnToken);
            sendJson(out, 200, res);
            return;
        }

        if ("GET".equals(method) && path.startsWith("/api/blob/")) {
            String blobId = path.substring("/api/blob/".length());
            BlobMeta meta = blobIndex.get(blobId);
            File f = new File(blobsDir, blobId);
            if (meta == null || !f.exists()) {
                sendJson(out, 404, errorJson("Зашифрованный блоб не найден или уже уничтожен"));
                return;
            }
            if (meta.once) {
                String provided = headers.getOrDefault("x-veil-burn-token", "");
                if (provided.isEmpty() || !sha256B64Url(provided.getBytes(StandardCharsets.UTF_8)).equals(meta.burnTokenHash)) {
                    sendJson(out, 403, errorJson("Недействительный токен одноразового чтения"));
                    return;
                }
                blobIndex.remove(blobId);
            }
            byte[] data = readFileBytes(f);
            if (meta.once) {
                // Затираем файл нулями перед физическим удалением
                try (FileOutputStream wipeOut = new FileOutputStream(f)) {
                    wipeOut.write(new byte[Math.min(data.length, 65536)]);
                } catch (IOException ignored) {}
                f.delete();
            }
            sendRawResponse(out, 200, "application/octet-stream", data, true);
            return;
        }

        if ("GET".equals(method) && path.startsWith("/api/ask/")) {
            String uname = path.substring("/api/ask/".length()).replaceFirst("^@", "").toLowerCase(Locale.ROOT);
            String uid = userIdByName.get(uname);
            if (uid == null) {
                sendJson(out, 404, errorJson("Пользователь не найден"));
                return;
            }
            JSONObject u = usersById.get(uid);
            JSONObject res = new JSONObject();
            res.put("username", uname);
            res.put("mailboxId", u.getString("mailboxId"));
            res.put("ikDhPub", u.getJSONObject("identity").getString("ikDhPub"));
            res.put("pow", issuePow("ask"));
            sendJson(out, 200, res);
            return;
        }

        if ("POST".equals(method) && path.startsWith("/api/ask/")) {
            String uname = path.substring("/api/ask/".length()).replaceFirst("^@", "").toLowerCase(Locale.ROOT);
            String uid = userIdByName.get(uname);
            if (uid == null) {
                sendJson(out, 404, errorJson("Пользователь не найден"));
                return;
            }
            JSONObject req = parseBodyJson(body);
            if (!verifyPow(req.optString("powChallenge"), req.optString("powNonce"), "ask")) {
                sendJson(out, 400, errorJson("Неверное решение Proof-of-Work"));
                return;
            }
            JSONObject u = usersById.get(uid);
            String mb = u.getString("mailboxId");
            String tag = "anon_" + randB64Url(8);
            Set<String> blocked = blockedAskTags.get(mb);
            if (blocked == null || !blocked.contains(tag)) {
                JSONObject item = new JSONObject();
                item.put("id", "ask_" + randB64Url(10));
                item.put("payloadB64", req.getString("payloadB64"));
                item.put("senderBlockTag", tag);
                asksByMailbox.computeIfAbsent(mb, k -> Collections.synchronizedList(new ArrayList<>())).add(item);
                pushEventToMailbox(mb, "ask.new", item, null);
            }
            JSONObject ok = new JSONObject();
            ok.put("ok", true);
            sendJson(out, 200, ok);
            return;
        }

        sendJson(out, 404, errorJson("Маршрут не найден"));
    }

    // ─────────────────────── Бинарный WebSocket RPC (8-байтный заголовок) ───────────────────────

    private final class WsPeer {
        final Socket socket;
        final InputStream in;
        final OutputStream out;
        volatile String userId;
        volatile String mailboxId;

        WsPeer(Socket s, InputStream i, OutputStream o) {
            this.socket = s; this.in = i; this.out = o;
        }

        synchronized void sendWsFrame(int opcode, byte[] payload) throws IOException {
            ByteArrayOutputStream bos = new ByteArrayOutputStream(10 + payload.length);
            bos.write(0x80 | (opcode & 0x0F));
            if (payload.length < 126) {
                bos.write(payload.length);
            } else if (payload.length <= 65535) {
                bos.write(126);
                bos.write((payload.length >> 8) & 0xFF);
                bos.write(payload.length & 0xFF);
            } else {
                bos.write(127);
                for (int shift = 56; shift >= 0; shift -= 8) {
                    bos.write((int) (((long) payload.length >> shift) & 0xFF));
                }
            }
            bos.write(payload);
            out.write(bos.toByteArray());
            out.flush();
        }

        void sendProtocolFrame(int frameType, int reqId, JSONObject meta, byte[] bodyBytes) {
            try {
                byte[] metaBytes = meta != null ? meta.toString().getBytes(StandardCharsets.UTF_8) : new byte[0];
                byte[] rawBody = bodyBytes != null ? bodyBytes : new byte[0];
                ByteBuffer buf = ByteBuffer.allocate(8 + metaBytes.length + rawBody.length);
                buf.put(PROTOCOL_MAGIC);
                buf.put((byte) frameType);
                buf.putInt(reqId);
                buf.putShort((short) metaBytes.length);
                buf.put(metaBytes);
                buf.put(rawBody);
                sendWsFrame(0x02, buf.array());
            } catch (IOException ignored) {
            }
        }
    }

    private void runWebSocketSession(WsPeer peer) {
        try {
            while (true) {
                int b0 = peer.in.read();
                int b1 = peer.in.read();
                if (b0 < 0 || b1 < 0) break;
                int opcode = b0 & 0x0F;
                boolean masked = (b1 & 0x80) != 0;
                long len = b1 & 0x7F;
                if (len == 126) {
                    byte[] ext = MeshSocksBridge.readExact(peer.in, 2);
                    len = ((ext[0] & 0xFF) << 8) | (ext[1] & 0xFF);
                } else if (len == 127) {
                    byte[] ext = MeshSocksBridge.readExact(peer.in, 8);
                    len = 0;
                    for (int i = 0; i < 8; i++) len = (len << 8) | (ext[i] & 0xFF);
                }
                if (len > 2 * 1024 * 1024) break;
                byte[] mask = masked ? MeshSocksBridge.readExact(peer.in, 4) : null;
                byte[] payload = MeshSocksBridge.readExact(peer.in, (int) len);
                if (masked) {
                    for (int i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
                }

                if (opcode == 0x08) break; // CLOSE
                if (opcode == 0x09) { peer.sendWsFrame(0x0A, payload); continue; }
                if (opcode == 0x02 && payload.length >= 8 && payload[0] == PROTOCOL_MAGIC) {
                    handleBinaryRpcFrame(peer, payload);
                }
            }
        } catch (Exception ignored) {
        } finally {
            if (peer.mailboxId != null) {
                Set<WsPeer> set = onlineByMailbox.get(peer.mailboxId);
                if (set != null) set.remove(peer);
            }
            try { peer.socket.close(); } catch (IOException ignored) {}
        }
    }

    private void handleBinaryRpcFrame(WsPeer peer, byte[] frame) {
        ByteBuffer bb = ByteBuffer.wrap(frame);
        bb.get(); // magic
        int type = bb.get() & 0xFF;
        int reqId = bb.getInt();
        int metaLen = bb.getShort() & 0xFFFF;

        if (type == 0x06) return; // Шумовой COVER-пакет молча отбрасываем
        if (type == 0x04) {       // Прикладной PING -> PONG
            JSONObject pong = new JSONObject();
            try { pong.put("ts", System.currentTimeMillis()); } catch (Exception ignored) {}
            peer.sendProtocolFrame(0x05, reqId, pong, null);
            return;
        }
        if (type != 0x01 || 8 + metaLen > frame.length) return;

        try {
            JSONObject meta = metaLen > 0
                    ? new JSONObject(new String(frame, 8, metaLen, StandardCharsets.UTF_8))
                    : new JSONObject();
            byte[] body = Arrays.copyOfRange(frame, 8 + metaLen, frame.length);
            String action = meta.optString("m", meta.optString("action", ""));
            JSONObject params = meta.optJSONObject("p") != null
                    ? meta.getJSONObject("p")
                    : (meta.optJSONObject("params") != null ? meta.getJSONObject("params") : new JSONObject());

            JSONObject result = dispatchRpc(peer, action, params, body);
            JSONObject resMeta = new JSONObject();
            resMeta.put("ok", true);
            resMeta.put("r", result);
            resMeta.put("data", result);
            peer.sendProtocolFrame(0x02, reqId, resMeta, null);
        } catch (Exception err) {
            try {
                String msg = err.getMessage() != null ? err.getMessage() : "Ошибка RPC";
                JSONObject resMeta = new JSONObject();
                resMeta.put("ok", false);
                resMeta.put("e", msg);
                resMeta.put("error", msg);
                peer.sendProtocolFrame(0x02, reqId, resMeta, null);
            } catch (Exception ignored) {}
        }
    }

    private JSONObject dispatchRpc(WsPeer peer, String action, JSONObject p, byte[] body) throws Exception {
        switch (action) {
            case "session.auth": {
                String token = p.optString("token", "");
                String uid = sessions.get(token);
                if (uid == null) throw new IllegalArgumentException("Сессия недействительна");
                JSONObject user = usersById.get(uid);
                peer.userId = uid;
                peer.mailboxId = user.getString("mailboxId");
                onlineByMailbox.computeIfAbsent(peer.mailboxId, k -> new CopyOnWriteArraySet<>()).add(peer);

                JSONObject res = new JSONObject();
                res.put("userId", uid);
                res.put("username", user.getString("username"));
                res.put("mailboxId", peer.mailboxId);
                res.put("mailboxWriteToken", user.getString("mailboxWriteToken"));
                res.put("remainingOpks", user.getJSONArray("oneTimePreKeys").length());
                return res;
            }
            case "directory.bundle":
            case "keys.fetchBundle": {
                requireAuth(peer);
                String rawQuery = p.optString("query", p.optString("username", "")).trim();
                String uname = rawQuery.replaceFirst("^@", "").toLowerCase(Locale.ROOT);
                String targetUid = usersById.containsKey(rawQuery)
                        ? rawQuery
                        : (!uname.isEmpty() ? userIdByName.get(uname) : p.optString("userId", null));
                if (targetUid == null || !usersById.containsKey(targetUid)) {
                    throw new IllegalArgumentException("Собеседник @" + uname + " не найден на этом узле");
                }
                JSONObject target = usersById.get(targetUid);
                Object opk = JSONObject.NULL;
                synchronized (target) {
                    JSONArray arr = target.getJSONArray("oneTimePreKeys");
                    if (arr.length() > 0) {
                        opk = arr.get(0);
                        JSONArray rest = new JSONArray();
                        for (int i = 1; i < arr.length(); i++) rest.put(arr.get(i));
                        target.put("oneTimePreKeys", rest);
                        persistUsers();
                    }
                }
                JSONObject res = new JSONObject();
                res.put("userId", targetUid);
                res.put("username", target.getString("username"));
                res.put("mailboxId", target.getString("mailboxId"));
                res.put("mailboxWriteToken", target.getString("mailboxWriteToken"));
                res.put("identity", target.getJSONObject("identity"));
                res.put("signedPreKey", target.getJSONObject("signedPreKey"));
                res.put("oneTimePreKey", opk);
                return res;
            }
            case "keys.rotateSpk": {
                requireAuth(peer);
                JSONObject user = usersById.get(peer.userId);
                JSONObject spk = p.optJSONObject("signedPreKey");
                if (spk != null) {
                    synchronized (user) {
                        user.put("signedPreKey", spk);
                        persistUsers();
                    }
                }
                JSONObject res = new JSONObject();
                res.put("ok", true);
                return res;
            }
            case "keys.replenishOpk": {
                requireAuth(peer);
                JSONObject user = usersById.get(peer.userId);
                JSONArray more = p.optJSONArray("oneTimePreKeys");
                if (more != null) {
                    synchronized (user) {
                        JSONArray cur = user.getJSONArray("oneTimePreKeys");
                        for (int i = 0; i < more.length() && cur.length() < 120; i++) cur.put(more.get(i));
                        persistUsers();
                    }
                }
                JSONObject res = new JSONObject();
                res.put("ok", true);
                return res;
            }
            case "relay.drop": {
                String mb = p.optString("mailboxId", "");
                String targetUid = userIdByMailbox.get(mb);
                if (targetUid == null) throw new IllegalArgumentException("Почтовый ящик не найден");
                JSONObject recipient = usersById.get(targetUid);
                if (!verifyHmacWriteProof(recipient.getString("mailboxWriteToken"), body, p.optString("writeProof", ""))) {
                    throw new IllegalArgumentException("Недействительный токен доставки ящика");
                }
                String envId = "env_" + randB64Url(12);
                long exp = System.currentTimeMillis() + 14L * 86400_000L;
                mailboxes.computeIfAbsent(mb, k -> Collections.synchronizedList(new ArrayList<>()))
                        .add(new EnvelopeItem(envId, body, exp));

                JSONObject evMeta = new JSONObject();
                evMeta.put("id", envId);
                evMeta.put("expiresAt", exp);
                pushEventToMailbox(mb, "mailbox.envelope", evMeta, body);

                JSONObject res = new JSONObject();
                res.put("id", envId);
                res.put("expiresAt", exp);
                return res;
            }
            case "webrtc.signal": {
                String mb = p.optString("mailboxId", "");
                String targetUid = userIdByMailbox.get(mb);
                if (targetUid == null) throw new IllegalArgumentException("Адресат недоступен");
                JSONObject recipient = usersById.get(targetUid);
                if (!verifyHmacWriteProof(recipient.getString("mailboxWriteToken"), body, p.optString("writeProof", ""))) {
                    throw new IllegalArgumentException("Недействительный токен сигналинга");
                }
                JSONObject evMeta = new JSONObject();
                evMeta.put("ts", System.currentTimeMillis());
                int delivered = pushEventToMailbox(mb, "webrtc.signal", evMeta, body);
                JSONObject res = new JSONObject();
                res.put("relayed", delivered > 0);
                return res;
            }
            case "voice.frame": {
                String mb = p.optString("mailboxId", "");
                String targetUid = userIdByMailbox.get(mb);
                if (targetUid == null) throw new IllegalArgumentException("Адресат недоступен");
                JSONObject recipient = usersById.get(targetUid);
                if (!verifyHmacWriteProof(recipient.getString("mailboxWriteToken"), body, p.optString("writeProof", ""))) {
                    throw new IllegalArgumentException("Недействительный токен голосового канала");
                }
                JSONObject evMeta = new JSONObject();
                evMeta.put("ts", System.currentTimeMillis());
                int delivered = pushEventToMailbox(mb, "voice.frame", evMeta, body);
                JSONObject res = new JSONObject();
                res.put("relayed", delivered > 0);
                return res;
            }
            case "mailbox.pull": {
                requireAuth(peer);
                List<EnvelopeItem> list = mailboxes.getOrDefault(peer.mailboxId, Collections.emptyList());
                JSONArray envs = new JSONArray();
                synchronized (list) {
                    for (EnvelopeItem item : list) {
                        JSONObject o = new JSONObject();
                        o.put("id", item.id);
                        o.put("blobB64", toB64Url(item.sealedBytes));
                        o.put("expiresAt", item.expiresAt);
                        envs.put(o);
                    }
                }
                List<JSONObject> asks = asksByMailbox.getOrDefault(peer.mailboxId, Collections.emptyList());
                JSONArray askArr = new JSONArray();
                synchronized (asks) {
                    for (JSONObject a : asks) askArr.put(a);
                }
                JSONObject res = new JSONObject();
                res.put("envelopes", envs);
                res.put("asks", askArr);
                return res;
            }
            case "mailbox.ack": {
                requireAuth(peer);
                JSONArray ids = p.optJSONArray("ids");
                if (ids != null) {
                    Set<String> ackSet = ConcurrentHashMap.newKeySet();
                    for (int i = 0; i < ids.length(); i++) ackSet.add(ids.optString(i));
                    List<EnvelopeItem> list = mailboxes.get(peer.mailboxId);
                    if (list != null) list.removeIf(e -> ackSet.contains(e.id));
                }
                JSONArray askIds = p.optJSONArray("askIds");
                if (askIds != null) {
                    Set<String> ackSet = ConcurrentHashMap.newKeySet();
                    for (int i = 0; i < askIds.length(); i++) ackSet.add(askIds.optString(i));
                    List<JSONObject> asks = asksByMailbox.get(peer.mailboxId);
                    if (asks != null) asks.removeIf(a -> ackSet.contains(a.optString("id")));
                }
                JSONObject res = new JSONObject();
                res.put("ok", true);
                return res;
            }
            case "mailbox.rotate": {
                requireAuth(peer);
                JSONObject user = usersById.get(peer.userId);
                String oldMb = user.getString("mailboxId");
                String newMb = "mb_" + randB64Url(16);
                String newWt = randB64Url(24);
                userIdByMailbox.remove(oldMb);
                user.put("mailboxId", newMb);
                user.put("mailboxWriteToken", newWt);
                userIdByMailbox.put(newMb, peer.userId);
                peer.mailboxId = newMb;
                onlineByMailbox.computeIfAbsent(newMb, k -> new CopyOnWriteArraySet<>()).add(peer);
                persistUsers();

                JSONObject res = new JSONObject();
                res.put("mailboxId", newMb);
                res.put("mailboxWriteToken", newWt);
                return res;
            }
            case "ask.block": {
                requireAuth(peer);
                String tag = p.optString("senderBlockTag", "");
                if (!tag.isEmpty()) {
                    blockedAskTags.computeIfAbsent(peer.mailboxId, k -> ConcurrentHashMap.newKeySet()).add(tag);
                }
                JSONObject res = new JSONObject();
                res.put("ok", true);
                return res;
            }
            case "turn.credentials": {
                JSONObject stun = new JSONObject();
                stun.put("urls", "stun:stun.l.google.com:19302");
                JSONArray arr = new JSONArray();
                arr.put(stun);
                JSONObject res = new JSONObject();
                res.put("iceServers", arr);
                return res;
            }
            default:
                throw new IllegalArgumentException("Неизвестный метод: " + action);
        }
    }

    private void requireAuth(WsPeer peer) {
        if (peer.userId == null) throw new IllegalArgumentException("Требуется авторизация сессии");
    }

    private int pushEventToMailbox(String mailboxId, String eventName, JSONObject data, byte[] binaryBody) {
        Set<WsPeer> peers = onlineByMailbox.get(mailboxId);
        if (peers == null || peers.isEmpty()) return 0;
        JSONObject ev = new JSONObject();
        try {
            ev.put("ev", eventName);
            ev.put("d", data);
            ev.put("event", eventName);
            ev.put("data", data);
        } catch (Exception ignored) {}
        int n = 0;
        for (WsPeer p : peers) {
            p.sendProtocolFrame(0x03, 0, ev, binaryBody);
            n++;
        }
        return n;
    }

    // ─────────────────────── Потоковое чтение локальных URI без копий и статика ───────────────────────

    private void serveLocalContentUri(String method, String rawQuery, Map<String, String> headers, OutputStream out) throws IOException {
        Map<String, String> q = new HashMap<>();
        if (rawQuery != null && !rawQuery.isEmpty()) {
            for (String pair : rawQuery.split("&")) {
                int eq = pair.indexOf('=');
                if (eq > 0) {
                    q.put(
                            java.net.URLDecoder.decode(pair.substring(0, eq), "UTF-8"),
                            java.net.URLDecoder.decode(pair.substring(eq + 1), "UTF-8")
                    );
                }
            }
        }

        String tok = q.get("tok");
        String uriB64 = q.get("uri");
        if (tok == null || uriB64 == null || !MessageDigest.isEqual(
                tok.getBytes(StandardCharsets.UTF_8),
                localRefSecret.getBytes(StandardCharsets.UTF_8)
        )) {
            sendRawResponse(out, 403, "text/plain; charset=utf-8", "Forbidden".getBytes(StandardCharsets.UTF_8), false);
            return;
        }

        String rawUri;
        try {
            byte[] decoded = Base64.decode(uriB64, Base64.URL_SAFE | Base64.NO_PADDING | Base64.NO_WRAP);
            rawUri = new String(decoded, StandardCharsets.UTF_8);
        } catch (Exception e) {
            sendRawResponse(out, 400, "text/plain; charset=utf-8", "Bad URI".getBytes(StandardCharsets.UTF_8), false);
            return;
        }

        if (!rawUri.startsWith("content://")) {
            sendRawResponse(out, 400, "text/plain; charset=utf-8", "Only content:// allowed".getBytes(StandardCharsets.UTF_8), false);
            return;
        }

        Uri contentUri = Uri.parse(rawUri);
        ContentResolver resolver = appContext.getContentResolver();

        // Быстрая миниатюра для встроенной галереи скрепки и превью без копирования исходника
        if ("1".equals(q.get("thumb"))) {
            try {
                Bitmap bmp = null;
                if (Build.VERSION.SDK_INT >= 29) {
                    bmp = resolver.loadThumbnail(contentUri, new Size(260, 260), null);
                } else {
                    try (InputStream is = resolver.openInputStream(contentUri)) {
                        if (is != null) {
                            BitmapFactory.Options opts = new BitmapFactory.Options();
                            opts.inSampleSize = 4;
                            bmp = BitmapFactory.decodeStream(is, null, opts);
                        }
                    }
                }
                if (bmp != null) {
                    ByteArrayOutputStream bos = new ByteArrayOutputStream();
                    bmp.compress(Bitmap.CompressFormat.JPEG, 76, bos);
                    bmp.recycle();
                    byte[] jpg = bos.toByteArray();
                    sendRawResponse(out, 200, "image/jpeg", "HEAD".equals(method) ? new byte[0] : jpg, false);
                    return;
                }
            } catch (Exception ignored) {
                // Если миниатюра недоступна — отдаём поток ниже или 404
            }
        }

        String mime = resolver.getType(contentUri);
        if (mime == null || mime.trim().isEmpty()) {
            mime = q.getOrDefault("mime", "application/octet-stream");
        }

        try (AssetFileDescriptor afd = resolver.openAssetFileDescriptor(contentUri, "r")) {
            if (afd == null) {
                sendRawResponse(out, 404, "text/plain; charset=utf-8", "Source file missing".getBytes(StandardCharsets.UTF_8), false);
                return;
            }
            long totalLen = afd.getLength();
            String rangeHdr = headers.get("range");

            if (totalLen > 0 && rangeHdr != null && rangeHdr.startsWith("bytes=")) {
                String spec = rangeHdr.substring(6).trim();
                int dash = spec.indexOf('-');
                long start = 0;
                long end = totalLen - 1;
                if (dash >= 0) {
                    String s1 = spec.substring(0, dash).trim();
                    String s2 = spec.substring(dash + 1).trim();
                    if (!s1.isEmpty()) start = Math.max(0, Long.parseLong(s1));
                    if (!s2.isEmpty()) end = Math.min(totalLen - 1, Long.parseLong(s2));
                }
                if (start > end || start >= totalLen) {
                    String hdr416 = "HTTP/1.1 416 Range Not Satisfiable\r\n"
                            + "Content-Range: bytes */" + totalLen + "\r\n"
                            + "Connection: close\r\n\r\n";
                    out.write(hdr416.getBytes(StandardCharsets.UTF_8));
                    out.flush();
                    return;
                }
                long chunkLen = (end - start) + 1;
                String hdr206 = "HTTP/1.1 206 Partial Content\r\n"
                        + "Content-Type: " + mime + "\r\n"
                        + "Accept-Ranges: bytes\r\n"
                        + "Content-Range: bytes " + start + "-" + end + "/" + totalLen + "\r\n"
                        + "Content-Length: " + chunkLen + "\r\n"
                        + "Cache-Control: private, max-age=60\r\n"
                        + "Connection: close\r\n\r\n";
                out.write(hdr206.getBytes(StandardCharsets.UTF_8));
                if (!"HEAD".equals(method)) {
                    try (InputStream fis = afd.createInputStream()) {
                        long skipped = 0;
                        while (skipped < start) {
                            long s = fis.skip(start - skipped);
                            if (s <= 0) break;
                            skipped += s;
                        }
                        byte[] buf = new byte[32768];
                        long rem = chunkLen;
                        while (rem > 0) {
                            int r = fis.read(buf, 0, (int) Math.min(buf.length, rem));
                            if (r < 0) break;
                            out.write(buf, 0, r);
                            rem -= r;
                        }
                    }
                }
                out.flush();
                return;
            }

            try (InputStream fis = afd.createInputStream()) {
                if (totalLen >= 0) {
                    String hdr200 = "HTTP/1.1 200 OK\r\n"
                            + "Content-Type: " + mime + "\r\n"
                            + "Accept-Ranges: bytes\r\n"
                            + "Content-Length: " + totalLen + "\r\n"
                            + "Cache-Control: private, max-age=60\r\n"
                            + "Connection: close\r\n\r\n";
                    out.write(hdr200.getBytes(StandardCharsets.UTF_8));
                    if (!"HEAD".equals(method)) {
                        byte[] buf = new byte[32768];
                        int r;
                        while ((r = fis.read(buf)) >= 0) {
                            out.write(buf, 0, r);
                        }
                    }
                    out.flush();
                } else {
                    byte[] all = readAllBytes(fis);
                    sendRawResponse(out, 200, mime, "HEAD".equals(method) ? new byte[0] : all, false);
                }
            }
        } catch (SecurityException se) {
            sendRawResponse(out, 403, "text/plain; charset=utf-8", "Permission revoked".getBytes(StandardCharsets.UTF_8), false);
        } catch (Exception e) {
            sendRawResponse(out, 404, "text/plain; charset=utf-8", "Not found".getBytes(StandardCharsets.UTF_8), false);
        }
    }

    private void serveStaticAsset(String method, String path, OutputStream out) throws IOException {
        if ("/sw.js".equals(path)) {
            byte[] sw = ("self.addEventListener('install',()=>self.skipWaiting());"
                    + "self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));")
                    .getBytes(StandardCharsets.UTF_8);
            sendRawResponse(out, 200, "text/javascript; charset=utf-8", "HEAD".equals(method) ? new byte[0] : sw, false);
            return;
        }
        String assetPath;
        if ("/".equals(path)) {
            assetPath = "www/public/index.html";
        } else if (path.startsWith("/q/")) {
            assetPath = "www/public/ask.html";
        } else if (path.startsWith("/shared/")) {
            assetPath = "www" + path;
        } else if (path.startsWith("/public/")) {
            assetPath = "www" + path;
        } else {
            assetPath = "www/public" + path;
        }

        try (InputStream is = assets.open(assetPath)) {
            byte[] bytes = readAllBytes(is);
            sendRawResponse(out, 200, guessMime(assetPath), "HEAD".equals(method) ? new byte[0] : bytes, false);
        } catch (IOException notFound) {
            sendRawResponse(out, 404, "text/plain; charset=utf-8", "404 Not Found".getBytes(StandardCharsets.UTF_8), false);
        }
    }

    private static String guessMime(String p) {
        if (p.endsWith(".html")) return "text/html; charset=utf-8";
        if (p.endsWith(".mjs") || p.endsWith(".js")) return "text/javascript; charset=utf-8";
        if (p.endsWith(".css")) return "text/css; charset=utf-8";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".json") || p.endsWith(".webmanifest")) return "application/json; charset=utf-8";
        if (p.endsWith(".wasm")) return "application/wasm";
        return "application/octet-stream";
    }

    private JSONObject issuePow(String purpose) throws Exception {
        int bits = 12; // Быстрый мобильный порог PoW (~10–25 мс на ARM)
        long exp = System.currentTimeMillis() + 300_000L;
        String rand = randB64Url(12);
        String payload = purpose + "." + bits + "." + exp + "." + rand;
        String sig = toB64Url(hmacSha256(powSecret, payload.getBytes(StandardCharsets.UTF_8)));
        JSONObject res = new JSONObject();
        res.put("challengeToken", payload + "." + sig);
        res.put("difficultyBits", bits);
        res.put("expiresAt", exp);
        return res;
    }

    private boolean verifyPow(String token, String nonce, String expectedPurpose) throws Exception {
        String[] parts = token.split("\\.");
        if (parts.length != 5 || !expectedPurpose.equals(parts[0])) return false;
        int bits = Integer.parseInt(parts[1]);
        long exp = Long.parseLong(parts[2]);
        if (exp < System.currentTimeMillis()) return false;
        String payload = parts[0] + "." + parts[1] + "." + parts[2] + "." + parts[3];
        String expectedSig = toB64Url(hmacSha256(powSecret, payload.getBytes(StandardCharsets.UTF_8)));
        if (!MessageDigest.isEqual(parts[4].getBytes(StandardCharsets.UTF_8), expectedSig.getBytes(StandardCharsets.UTF_8))) {
            return false;
        }
        MessageDigest sha = MessageDigest.getInstance("SHA-256");
        byte[] digest = sha.digest(("MSG-POW-v1:" + token + ":" + nonce).getBytes(StandardCharsets.UTF_8));
        int zeros = 0;
        for (byte b : digest) {
            int v = b & 0xFF;
            if (v == 0) {
                zeros += 8;
            } else {
                zeros += Integer.numberOfLeadingZeros(v) - 24;
                break;
            }
        }
        return zeros >= bits;
    }

    private JSONObject buildSyntheticAuthKey(String uname) throws Exception {
        byte[] mat = hmacSha256(synthSecret, ("SYNTH:" + uname).getBytes(StandardCharsets.UTF_8));
        byte[] ct = new byte[154];
        System.arraycopy(mat, 0, ct, 0, 32);
        JSONObject obj = new JSONObject();
        obj.put("v", 1);
        obj.put("alg", "argon2id");
        obj.put("iv", toB64Url(Arrays.copyOfRange(mat, 0, 12)));
        obj.put("ct", toB64Url(ct));
        return obj;
    }

    /** Проверяет 64-байтную подпись WebCrypto ECDSA P-256 (формат IEEE P1363 r||s) на 65-байтном raw ключе */
    private static boolean verifyP256Ecdsa(byte[] rawPub65, byte[] message, byte[] sigP1363) {
        try {
            if (rawPub65.length != 65 || rawPub65[0] != 0x04 || sigP1363.length != 64) return false;
            byte[] spki = new byte[P256_SPKI_PREFIX.length + 65];
            System.arraycopy(P256_SPKI_PREFIX, 0, spki, 0, P256_SPKI_PREFIX.length);
            System.arraycopy(rawPub65, 0, spki, P256_SPKI_PREFIX.length, 65);

            PublicKey pub = KeyFactory.getInstance("EC").generatePublic(new X509EncodedKeySpec(spki));
            Signature verifier = Signature.getInstance("SHA256withECDSA");
            verifier.initVerify(pub);
            verifier.update(message);
            return verifier.verify(p1363ToDer(sigP1363));
        } catch (Exception e) {
            return false;
        }
    }

    private static byte[] p1363ToDer(byte[] sig64) {
        byte[] r = trimDerInt(Arrays.copyOfRange(sig64, 0, 32));
        byte[] s = trimDerInt(Arrays.copyOfRange(sig64, 32, 64));
        int seqLen = 2 + r.length + 2 + s.length;
        ByteArrayOutputStream bos = new ByteArrayOutputStream(2 + seqLen);
        bos.write(0x30);
        bos.write(seqLen);
        bos.write(0x02);
        bos.write(r.length);
        bos.write(r, 0, r.length);
        bos.write(0x02);
        bos.write(s.length);
        bos.write(s, 0, s.length);
        return bos.toByteArray();
    }

    private static byte[] trimDerInt(byte[] raw) {
        int i = 0;
        while (i < raw.length - 1 && raw[i] == 0) i++;
        boolean needPad = (raw[i] & 0x80) != 0;
        byte[] out = new byte[raw.length - i + (needPad ? 1 : 0)];
        System.arraycopy(raw, i, out, needPad ? 1 : 0, raw.length - i);
        return out;
    }

    private static boolean verifyHmacWriteProof(String writeToken, byte[] payload, String proofB64) throws Exception {
        byte[] expected = hmacSha256(writeToken.getBytes(StandardCharsets.UTF_8), payload);
        byte[] actual = fromB64Url(proofB64);
        return MessageDigest.isEqual(expected, actual);
    }

    private static byte[] hmacSha256(byte[] key, byte[] data) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(key, "HmacSHA256"));
        return mac.doFinal(data);
    }

    private static String sha256B64Url(byte[] data) throws Exception {
        return toB64Url(MessageDigest.getInstance("SHA-256").digest(data));
    }

    private byte[] randBytes(int n) {
        byte[] b = new byte[n];
        rng.nextBytes(b);
        return b;
    }

    private String randB64Url(int byteLen) {
        return toB64Url(randBytes(byteLen));
    }

    private static String toB64Url(byte[] b) {
        return Base64.encodeToString(b, Base64.URL_SAFE | Base64.NO_PADDING | Base64.NO_WRAP);
    }

    private static byte[] fromB64Url(String s) {
        return Base64.decode(s, Base64.URL_SAFE | Base64.NO_PADDING | Base64.NO_WRAP);
    }

    private static String bytesToHex(byte[] b) {
        StringBuilder sb = new StringBuilder(b.length * 2);
        for (byte v : b) sb.append(String.format("%02x", v & 0xFF));
        return sb.toString();
    }

    private synchronized void persistUsers() {
        try {
            JSONArray arr = new JSONArray();
            for (JSONObject u : usersById.values()) arr.put(u);
            File tmp = new File(nodeDir, "blind_users.tmp");
            try (FileOutputStream fos = new FileOutputStream(tmp)) {
                fos.write(arr.toString().getBytes(StandardCharsets.UTF_8));
                fos.getFD().sync();
            }
            tmp.renameTo(usersFile);
        } catch (Exception ignored) {
        }
    }

    private void loadPersistedUsers() {
        if (!usersFile.exists()) return;
        try {
            String raw = new String(readFileBytes(usersFile), StandardCharsets.UTF_8);
            JSONArray arr = new JSONArray(raw);
            for (int i = 0; i < arr.length(); i++) {
                JSONObject u = arr.getJSONObject(i);
                String uid = u.getString("id");
                usersById.put(uid, u);
                userIdByName.put(u.getString("username"), uid);
                userIdByMailbox.put(u.getString("mailboxId"), uid);
            }
        } catch (Exception ignored) {
        }
    }

    private static JSONObject parseBodyJson(byte[] b) throws Exception {
        if (b == null || b.length == 0) return new JSONObject();
        return new JSONObject(new String(b, StandardCharsets.UTF_8));
    }

    private static JSONObject errorJson(String msg) {
        JSONObject o = new JSONObject();
        try { o.put("error", msg); } catch (Exception ignored) {}
        return o;
    }

    private static void sendJson(OutputStream out, int code, JSONObject json) throws IOException {
        sendRawResponse(out, code, "application/json; charset=utf-8", json.toString().getBytes(StandardCharsets.UTF_8), true);
    }

    private static void sendRawResponse(OutputStream out, int code, String contentType, byte[] body, boolean cors) throws IOException {
        StringBuilder h = new StringBuilder();
        h.append("HTTP/1.1 ").append(code).append(" OK\r\n");
        h.append("Content-Type: ").append(contentType).append("\r\n");
        h.append("Cache-Control: no-store\r\n");
        h.append("X-Content-Type-Options: nosniff\r\n");
        if (cors) {
            h.append("Access-Control-Allow-Origin: *\r\n");
            h.append("Access-Control-Allow-Methods: GET, HEAD, POST, OPTIONS\r\n");
            h.append("Access-Control-Allow-Headers: content-type, authorization, x-veil-once, x-veil-burn-token, x-veil-ttl\r\n");
        }
        h.append("Content-Length: ").append(body.length).append("\r\n\r\n");
        out.write(h.toString().getBytes(StandardCharsets.UTF_8));
        if (body.length > 0) out.write(body);
        out.flush();
    }

    private static byte[] readAllBytes(InputStream is) throws IOException {
        ByteArrayOutputStream bos = new ByteArrayOutputStream(4096);
        byte[] buf = new byte[8192];
        int n;
        while ((n = is.read(buf)) >= 0) bos.write(buf, 0, n);
        return bos.toByteArray();
    }

    private static byte[] readFileBytes(File f) throws IOException {
        try (FileInputStream fis = new FileInputStream(f)) {
            return readAllBytes(fis);
        }
    }
}
