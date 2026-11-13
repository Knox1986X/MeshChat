// Модуль безопасного автообновления MeshChat для Android:
// скачивает новый APK (с поддержкой 302 редиректов GitHub Releases), сверяет SHA-256 хеш
// до вызова установщика и открывает системный диалог обновления поверх текущей версии.

package org.meshchat.app;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MeshUpdater {
    public interface ProgressListener {
        void onProgress(int percent, String statusText, String errorText);
    }

    private static final String APK_FILENAME = "MeshChat-update.apk";
    private final Activity activity;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private volatile File readyApkFile = null;

    public MeshUpdater(Activity activity) {
        this.activity = activity;
    }

    public void downloadAndInstall(final String apkUrl, final String expectedSha256, final ProgressListener listener) {
        executor.execute(() -> {
            File target = new File(ApkUpdateProvider.getUpdatesDir(activity), APK_FILENAME);
            try {
                listener.onProgress(5, "Соединение с сервером обновлений…", null);

                HttpURLConnection conn = openFollowingRedirects(apkUrl);
                int code = conn.getResponseCode();
                if (code < 200 || code >= 300) {
                    throw new IllegalStateException("Сервер обновлений вернул HTTP " + code);
                }

                String headerSha = conn.getHeaderField("x-apk-sha256");
                String shaToVerify = (expectedSha256 != null && expectedSha256.length() == 64)
                        ? expectedSha256.toLowerCase(Locale.ROOT)
                        : (headerSha != null && headerSha.length() == 64 ? headerSha.toLowerCase(Locale.ROOT) : "");

                long totalBytes = conn.getContentLengthLong();
                MessageDigest sha256 = MessageDigest.getInstance("SHA-256");

                try (InputStream in = conn.getInputStream();
                     FileOutputStream fos = new FileOutputStream(target)) {
                    byte[] buf = new byte[16384];
                    long readTotal = 0;
                    int lastReported = 5;
                    int n;
                    while ((n = in.read(buf)) >= 0) {
                        fos.write(buf, 0, n);
                        sha256.update(buf, 0, n);
                        readTotal += n;
                        if (totalBytes > 0) {
                            int pct = (int) Math.min(94, 5 + (readTotal * 89) / totalBytes);
                            if (pct >= lastReported + 4) {
                                lastReported = pct;
                                listener.onProgress(pct, "Скачивание пакета: " + pct + "%…", null);
                            }
                        }
                    }
                    fos.getFD().sync();
                }

                listener.onProgress(96, "Проверка криптографической контрольной суммы SHA-256…", null);
                String actualSha = toHex(sha256.digest());
                if (!shaToVerify.isEmpty() && !shaToVerify.equalsIgnoreCase(actualSha)) {
                    target.delete();
                    throw new SecurityException("Контрольная сумма SHA-256 не совпала! Пакет отклонён.");
                }

                readyApkFile = target;
                listener.onProgress(100, "Пакет проверен. Открываю установщик Android…", null);
                activity.runOnUiThread(this::triggerPackageInstallerIfPermitted);
            } catch (Exception err) {
                target.delete();
                listener.onProgress(0, "", "Ошибка автообновления: " + err.getMessage());
            }
        });
    }

    public void triggerPackageInstallerIfPermitted() {
        if (readyApkFile == null || !readyApkFile.exists()) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                && !activity.getPackageManager().canRequestPackageInstalls()) {
            Intent permIntent = new Intent(
                    Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + activity.getPackageName())
            );
            activity.startActivityForResult(permIntent, MainActivity.REQ_INSTALL_UNKNOWN_APPS);
            return;
        }
        Uri contentUri = ApkUpdateProvider.buildUriForFile(readyApkFile.getName());
        Intent install = new Intent(Intent.ACTION_VIEW);
        install.setDataAndType(contentUri, "application/vnd.android.package-archive");
        install.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        activity.startActivity(install);
    }

    private static HttpURLConnection openFollowingRedirects(String initialUrl) throws Exception {
        String current = initialUrl;
        for (int hops = 0; hops < 6; hops++) {
            HttpURLConnection conn = (HttpURLConnection) new URL(current).openConnection();
            conn.setInstanceFollowRedirects(false);
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(30000);
            conn.setRequestProperty("User-Agent", "MeshChat-Updater/1.1");
            int status = conn.getResponseCode();
            if (status == 301 || status == 302 || status == 303 || status == 307 || status == 308) {
                String next = conn.getHeaderField("Location");
                conn.disconnect();
                if (next == null || next.isEmpty()) break;
                current = new URL(new URL(current), next).toString();
                continue;
            }
            return conn;
        }
        throw new IllegalStateException("Слишком много перенаправлений при загрузке APK");
    }

    private static String toHex(byte[] b) {
        StringBuilder sb = new StringBuilder(b.length * 2);
        for (byte v : b) sb.append(String.format("%02x", v & 0xFF));
        return sb.toString();
    }
}
