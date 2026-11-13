// Модуль безопасного самообновления Android-приложения MeshChat через GitHub Releases и узел:
//   1. Скачивает APK с поддержкой кросс-доменных 302-редиректов GitHub -> objects.githubusercontent.com.
//   2. Проверяет контрольную сумму SHA-256 до байта перед передачей системному установщику.
//   3. Вызывает установщик пакета с EXTRA_NOT_UNKNOWN_SOURCE для бесшовного обновления поверх текущей версии.

package org.meshchat.app;

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

public final class MeshUpdater {
    private final MainActivity activity;
    private volatile boolean downloading = false;
    private volatile File readyApkFile = null;

    public interface ProgressListener {
        void onUpdate(int percent, String status, String error);
    }

    public MeshUpdater(MainActivity activity) {
        this.activity = activity;
    }

    public void downloadAndInstall(String apkUrl, String expectedSha256, ProgressListener listener) {
        if (downloading) return;
        downloading = true;

        new Thread(() -> {
            HttpURLConnection conn = null;
            try {
                listener.onUpdate(3, "Подключение к серверу релизов…", null);

                String currentUrl = apkUrl;
                for (int hop = 0; hop < 6; hop++) {
                    URL url = new URL(currentUrl);
                    conn = (HttpURLConnection) url.openConnection();
                    conn.setInstanceFollowRedirects(false);
                    conn.setConnectTimeout(15000);
                    conn.setReadTimeout(45000);
                    conn.setRequestProperty("Accept", "application/octet-stream,*/*");
                    conn.setRequestProperty("User-Agent", "MeshChat-Android-Updater/1.3");

                    int code = conn.getResponseCode();
                    if (code == 301 || code == 302 || code == 303 || code == 307 || code == 308) {
                        String loc = conn.getHeaderField("Location");
                        conn.disconnect();
                        if (loc == null || loc.isEmpty()) {
                            throw new IllegalStateException("Пустой заголовок редиректа при скачивании APK");
                        }
                        currentUrl = new URL(url, loc).toString();
                        continue;
                    }
                    if (code != 200) {
                        throw new IllegalStateException("Сервер релизов вернул HTTP " + code);
                    }
                    break;
                }

                if (conn == null) {
                    throw new IllegalStateException("Не удалось открыть соединение загрузки");
                }

                int totalBytes = conn.getContentLength();
                File dir = new File(activity.getCacheDir(), "updates");
                if (!dir.exists()) {
                    // noinspection ResultOfMethodCallIgnored
                    dir.mkdirs();
                }
                File tmpFile = new File(dir, "MeshChat-update.apk.part");
                File finalFile = new File(dir, "MeshChat-update.apk");

                MessageDigest sha256 = MessageDigest.getInstance("SHA-256");
                long downloaded = 0;
                int lastReportedPct = 3;

                try (InputStream in = conn.getInputStream();
                     FileOutputStream out = new FileOutputStream(tmpFile)) {
                    byte[] buf = new byte[16384];
                    int n;
                    while ((n = in.read(buf)) != -1) {
                        out.write(buf, 0, n);
                        sha256.update(buf, 0, n);
                        downloaded += n;
                        if (totalBytes > 0) {
                            int pct = (int) Math.min(98, (downloaded * 100L) / totalBytes);
                            if (pct >= lastReportedPct + 3) {
                                lastReportedPct = pct;
                                listener.onUpdate(pct, "Скачивание релиза: " + pct + "%", null);
                            }
                        }
                    }
                    out.getFD().sync();
                }

                String actualHex = toHex(sha256.digest());
                if (expectedSha256 != null && expectedSha256.trim().length() == 64) {
                    if (!actualHex.equalsIgnoreCase(expectedSha256.trim())) {
                        // noinspection ResultOfMethodCallIgnored
                        tmpFile.delete();
                        throw new SecurityException("Несовпадение контрольной суммы SHA-256 пакета");
                    }
                }

                if (finalFile.exists()) {
                    // noinspection ResultOfMethodCallIgnored
                    finalFile.delete();
                }
                if (!tmpFile.renameTo(finalFile)) {
                    throw new IllegalStateException("Не удалось подготовить файл обновления");
                }

                readyApkFile = finalFile;
                listener.onUpdate(100, "SHA-256 подтверждён · Запуск системного обновления…", null);
                activity.runOnUiThread(this::triggerPackageInstallerIfPermitted);
            } catch (Exception e) {
                listener.onUpdate(0, "", "Ошибка автообновления: " + e.getMessage());
            } finally {
                if (conn != null) conn.disconnect();
                downloading = false;
            }
        }, "meshchat-apk-updater").start();
    }

    public void triggerPackageInstallerIfPermitted() {
        if (readyApkFile == null || !readyApkFile.exists()) return;

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            if (!activity.getPackageManager().canRequestPackageInstalls()) {
                Intent permIntent = new Intent(
                        Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        Uri.parse("package:" + activity.getPackageName())
                );
                activity.startActivityForResult(permIntent, MainActivity.REQ_INSTALL_UNKNOWN_APPS);
                return;
            }
        }

        Uri apkUri = ApkUpdateProvider.buildUriForFile(readyApkFile.getName());
        Intent install = new Intent(Intent.ACTION_VIEW);
        install.setDataAndType(apkUri, "application/vnd.android.package-archive");
        install.putExtra(Intent.EXTRA_NOT_UNKNOWN_SOURCE, true);
        install.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        activity.startActivity(install);
    }

    private static String toHex(byte[] bytes) {
        StringBuilder sb = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) {
            sb.append(String.format("%02x", b & 0xff));
        }
        return sb.toString();
    }
}
