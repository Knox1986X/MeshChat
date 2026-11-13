// Локальный Android-мост WebSocket/HTTP -> SOCKS5 (Orbot 9050/9150 и i2pd 4447).
// Слушает исключительно петлевой интерфейс 127.0.0.1:17700 внутри телефона и передаёт
// имена .onion / .b32.i2p через RFC 1928 ATYP=0x03 (удалённый резолвинг без утечки DNS в ОС Android).

package org.meshchat.app;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MeshSocksBridge {
    public static final int BRIDGE_PORT = 27700;
    public static final int[] TOR_PORTS = new int[]{9050, 9150};
    public static final int[] I2P_PORTS = new int[]{4447};

    private ServerSocket serverSocket;
    private volatile int boundPort = BRIDGE_PORT;
    private volatile boolean running = false;
    private final ExecutorService pool = Executors.newCachedThreadPool();

    public synchronized void start() {
        if (running && serverSocket != null && !serverSocket.isClosed()) return;
        for (int candidate = BRIDGE_PORT; candidate <= BRIDGE_PORT + 8; candidate++) {
            try {
                ServerSocket srv = new ServerSocket();
                srv.setReuseAddress(true);
                srv.bind(new InetSocketAddress(InetAddress.getByName("127.0.0.1"), candidate), 32);
                serverSocket = srv;
                boundPort = candidate;
                running = true;
                pool.execute(this::acceptLoop);
                return;
            } catch (IOException ignored) {
            }
        }
    }

    public int getBoundPort() {
        return boundPort;
    }

    public synchronized void stop() {
        running = false;
        try {
            if (serverSocket != null) serverSocket.close();
        } catch (IOException ignored) {
        }
    }

    private void acceptLoop() {
        while (running) {
            try {
                final Socket client = serverSocket.accept();
                pool.execute(() -> handleClient(client));
            } catch (IOException e) {
                if (!running) break;
            }
        }
    }

    /** Устанавливает RFC 1928 SOCKS5 соединение с удалённым резолвингом домена (ATYP=0x03) */
    public static Socket openSocks5Tunnel(String targetHost, int targetPort, int[] candidatePorts) throws IOException {
        IOException lastErr = null;
        byte[] hostBytes = targetHost.getBytes(StandardCharsets.US_ASCII);
        if (hostBytes.length == 0 || hostBytes.length > 255) {
            throw new IOException("Некорректная длина скрытого домена");
        }

        for (int socksPort : candidatePorts) {
            Socket sock = new Socket();
            try {
                sock.connect(new InetSocketAddress("127.0.0.1", socksPort), 4000);
                sock.setSoTimeout(25000);
                OutputStream out = sock.getOutputStream();
                InputStream in = sock.getInputStream();

                // 1. Приветствие: VER=5, NMETHODS=1, NO_AUTH(0x00)
                out.write(new byte[]{0x05, 0x01, 0x00});
                out.flush();
                byte[] greetResp = readExact(in, 2);
                if (greetResp[0] != 0x05 || greetResp[1] != 0x00) {
                    throw new IOException("SOCKS5 прокси отверг метод без пароля");
                }

                // 2. Команда CONNECT с ATYP=0x03 (DOMAINNAME — защита от утечки DNS!)
                ByteArrayOutputStream req = new ByteArrayOutputStream(7 + hostBytes.length);
                req.write(0x05); // VER
                req.write(0x01); // CMD = CONNECT
                req.write(0x00); // RSV
                req.write(0x03); // ATYP = DOMAINNAME
                req.write(hostBytes.length & 0xFF);
                req.write(hostBytes);
                req.write((targetPort >> 8) & 0xFF);
                req.write(targetPort & 0xFF);
                out.write(req.toByteArray());
                out.flush();

                byte[] head = readExact(in, 4);
                if (head[0] != 0x05 || head[1] != 0x00) {
                    throw new IOException("SOCKS5 не смог открыть скрытый узел (REP=" + head[1] + ")");
                }
                int atyp = head[3] & 0xFF;
                if (atyp == 0x01) {
                    readExact(in, 6);
                } else if (atyp == 0x04) {
                    readExact(in, 18);
                } else if (atyp == 0x03) {
                    int len = readExact(in, 1)[0] & 0xFF;
                    readExact(in, len + 2);
                }
                sock.setSoTimeout(0);
                return sock;
            } catch (IOException err) {
                lastErr = err;
                try {
                    sock.close();
                } catch (IOException ignored) {
                }
            }
        }
        throw lastErr != null ? lastErr : new IOException("Демон Orbot / i2pd не запущен на устройстве");
    }

    private void handleClient(Socket client) {
        try {
            client.setSoTimeout(15000);
            InputStream in = client.getInputStream();
            OutputStream out = client.getOutputStream();

            String headerBlock = readHttpHeaderBlock(in);
            if (headerBlock == null || headerBlock.isEmpty()) {
                client.close();
                return;
            }
            String[] lines = headerBlock.split("\r\n");
            String[] reqParts = lines[0].split(" ");
            if (reqParts.length < 2) {
                client.close();
                return;
            }
            String pathAndQuery = reqParts[1];
            if (pathAndQuery.startsWith("/health")) {
                byte[] body = "{\"ok\":true,\"bridge\":\"meshchat-android-socks5\"}".getBytes(StandardCharsets.UTF_8);
                String resp = "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: "
                        + body.length + "\r\n\r\n";
                out.write(resp.getBytes(StandardCharsets.UTF_8));
                out.write(body);
                out.flush();
                client.close();
                return;
            }

            URI uri = URI.create("http://localhost" + pathAndQuery);
            String netKind = uri.getPath();
            String targetParam = extractQueryParam(uri.getRawQuery(), "target");
            if (targetParam == null) {
                writeHttpError(out, 400, "Missing target");
                client.close();
                return;
            }

            URI targetUri = URI.create(targetParam);
            String host = targetUri.getHost() != null ? targetUri.getHost().toLowerCase(Locale.ROOT) : "";
            int port = targetUri.getPort() > 0 ? targetUri.getPort() : 80;
            String remotePath = (targetUri.getRawPath() == null || targetUri.getRawPath().isEmpty()) ? "/ws" : targetUri.getRawPath();
            if (targetUri.getRawQuery() != null && !targetUri.getRawQuery().isEmpty()) {
                remotePath += "?" + targetUri.getRawQuery();
            }

            int[] ports;
            String transportTag;
            if ("/tor".equals(netKind) && host.endsWith(".onion")) {
                ports = TOR_PORTS;
                transportTag = "tor";
            } else if ("/i2p".equals(netKind) && host.endsWith(".i2p")) {
                ports = I2P_PORTS;
                transportTag = "i2p";
            } else {
                writeHttpError(out, 403, "Invalid hidden target");
                client.close();
                return;
            }

            String wsKey = null;
            for (int i = 1; i < lines.length; i++) {
                String l = lines[i];
                if (l.toLowerCase(Locale.ROOT).startsWith("sec-websocket-key:")) {
                    wsKey = l.substring(l.indexOf(':') + 1).trim();
                }
            }
            if (wsKey == null) {
                writeHttpError(out, 400, "Missing Sec-WebSocket-Key");
                client.close();
                return;
            }

            Socket upstream = openSocks5Tunnel(host, port, ports);
            client.setSoTimeout(0);

            String upgradeReq = "GET " + remotePath + " HTTP/1.1\r\n"
                    + "Host: " + host + (port == 80 ? "" : ":" + port) + "\r\n"
                    + "Upgrade: websocket\r\n"
                    + "Connection: Upgrade\r\n"
                    + "Sec-WebSocket-Version: 13\r\n"
                    + "Sec-WebSocket-Key: " + wsKey + "\r\n"
                    + "X-Veil-Transport: " + transportTag + "\r\n\r\n";

            OutputStream upOut = upstream.getOutputStream();
            InputStream upIn = upstream.getInputStream();
            upOut.write(upgradeReq.getBytes(StandardCharsets.UTF_8));
            upOut.flush();

            pool.execute(() -> pipeStream(in, upOut, upstream, client));
            pipeStream(upIn, out, client, upstream);
        } catch (Exception e) {
            try {
                writeHttpError(client.getOutputStream(), 502, e.getMessage());
            } catch (Exception ignored) {
            }
            try {
                client.close();
            } catch (IOException ignored) {
            }
        }
    }

    private static void pipeStream(InputStream src, OutputStream dst, Socket closeA, Socket closeB) {
        byte[] buf = new byte[16384];
        try {
            int n;
            while ((n = src.read(buf)) >= 0) {
                dst.write(buf, 0, n);
                dst.flush();
            }
        } catch (IOException ignored) {
        } finally {
            try {
                closeA.close();
            } catch (IOException ignored) {
            }
            try {
                closeB.close();
            } catch (IOException ignored) {
            }
        }
    }

    private static void writeHttpError(OutputStream out, int code, String msg) throws IOException {
        String clean = msg == null ? "Bridge Error" : msg.replace("\r", " ").replace("\n", " ");
        String resp = "HTTP/1.1 " + code + " Error\r\nContent-Type: text/plain; charset=utf-8\r\nConnection: close\r\n\r\n" + clean;
        out.write(resp.getBytes(StandardCharsets.UTF_8));
        out.flush();
    }

    private static String extractQueryParam(String query, String key) {
        if (query == null) return null;
        for (String pair : query.split("&")) {
            int eq = pair.indexOf('=');
            if (eq > 0 && pair.substring(0, eq).equals(key)) {
                try {
                    return java.net.URLDecoder.decode(pair.substring(eq + 1), "UTF-8");
                } catch (Exception e) {
                    return null;
                }
            }
        }
        return null;
    }

    static String readHttpHeaderBlock(InputStream in) throws IOException {
        ByteArrayOutputStream bos = new ByteArrayOutputStream(512);
        int state = 0;
        while (bos.size() < 32768) {
            int b = in.read();
            if (b < 0) break;
            bos.write(b);
            if ((state == 0 && b == '\r') || (state == 2 && b == '\r')) state++;
            else if ((state == 1 && b == '\n') || (state == 3 && b == '\n')) state++;
            else state = (b == '\r') ? 1 : 0;
            if (state == 4) {
                return new String(bos.toByteArray(), 0, bos.size() - 4, StandardCharsets.UTF_8);
            }
        }
        return null;
    }

    static byte[] readExact(InputStream in, int len) throws IOException {
        byte[] out = new byte[len];
        int off = 0;
        while (off < len) {
            int r = in.read(out, off, len - off);
            if (r < 0) throw new IOException("Неожиданный конец потока");
            off += r;
        }
        return out;
    }
}
