// Главный экран Android-приложения MeshChat v1.7.
// Запускает изолированный SOCKS5-мост (127.0.0.1:27700) и собственный локальный узел (127.0.0.1:27701),
// сбрасывает HTTP-кеш ассетов при обновлении версии (сохраняя IndexedDB и AndroidKeyStore Vault),
// управляет защитой от скриншотов FLAG_SECURE (по умолчанию ВЫКЛ), удержанием экрана, цветом системных баров,
// сохранением экспортируемых файлов в Загрузки, локальными уведомлениями, вибрацией и жестом «Назад».

package org.meshchat.app;

import android.Manifest;
import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.ClipData;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.util.concurrent.atomic.AtomicInteger;

public final class MainActivity extends Activity {
    private static final int REQ_FILE_CHOOSER = 1001;
    private static final int REQ_RECORD_AUDIO = 1002;
    public static final int REQ_INSTALL_UNKNOWN_APPS = 1003;
    private static final int REQ_POST_NOTIFICATIONS = 1004;

    private static final String LEGACY_PACKAGE = "org.meshchat.app";
    private static final String META_PREFS = "meshchat_meta";
    private static final String KEY_SCREENSHOT_PROTECTION = "screenshot_protection";
    private static final String KEY_KEEP_SCREEN_ON = "keep_screen_on";
    private static final String NOTIF_CHANNEL_ID = "meshchat_e2ee_messages";

    private WebView webView;
    private MeshSocksBridge socksBridge;
    private MeshLocalNode localNode;
    private MeshUpdater updater;
    private MeshNativeVault nativeVault;
    private ValueCallback<Uri[]> fileUploadCallback;
    private PermissionRequest pendingWebRtcPermission;
    private volatile boolean isForeground = true;
    private final AtomicInteger notifSeq = new AtomicInteger(2000);

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        SharedPreferences prefs = getSharedPreferences(META_PREFS, MODE_PRIVATE);
        boolean secureScreen = prefs.getBoolean(KEY_SCREENSHOT_PROTECTION, false);
        boolean keepAwake = prefs.getBoolean(KEY_KEEP_SCREEN_ON, false);

        Window window = getWindow();
        if (window != null) {
            applyWindowSecureFlag(secureScreen);
            applyKeepScreenOnFlag(keepAwake);
            window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
            window.setStatusBarColor(Color.parseColor("#0b0d14"));
            window.setNavigationBarColor(Color.parseColor("#0b0d14"));
        }

        ensureNotificationChannel();
        nativeVault = new MeshNativeVault(this);

        socksBridge = new MeshSocksBridge();
        socksBridge.start();

        localNode = new MeshLocalNode(this);
        localNode.startLoopback();
        updater = new MeshUpdater(this);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#0b0d14"));

        webView = new WebView(this);
        webView.setBackgroundColor(Color.parseColor("#0b0d14"));
        configureWebView(webView);

        // При обновлении версии очищаем ТОЛЬКО HTTP-кеш файлов (IndexedDB и AndroidKeyStore не затрагиваются)
        int currentVerCode = getCurrentVersionCode();
        int prevVerCode = prefs.getInt("last_ver_code", -1);
        if (prevVerCode != currentVerCode) {
            webView.clearCache(true);
            prefs.edit().putInt("last_ver_code", currentVerCode).apply();
        }

        root.addView(webView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
        ));
        setContentView(root);

        int port = localNode.getBoundPort();
        webView.loadUrl("http://127.0.0.1:" + port + "/?v=" + currentVerCode);
    }

    private void ensureNotificationChannel() {
        try {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;
            NotificationChannel ch = new NotificationChannel(
                    NOTIF_CHANNEL_ID,
                    "Сообщения и вызовы E2EE",
                    NotificationManager.IMPORTANCE_HIGH
            );
            ch.setDescription("Локальные уведомления MeshChat о входящих зашифрованных пакетах");
            ch.enableVibration(true);
            nm.createNotificationChannel(ch);
        } catch (Exception ignored) {
        }
    }

    private void applyWindowSecureFlag(boolean enabled) {
        Window window = getWindow();
        if (window == null) return;
        if (enabled) {
            window.addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        } else {
            window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
        }
    }

    private void applyKeepScreenOnFlag(boolean enabled) {
        Window window = getWindow();
        if (window == null) return;
        if (enabled) {
            window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        } else {
            window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        }
    }

    private boolean isScreenshotProtectionActive() {
        return getSharedPreferences(META_PREFS, MODE_PRIVATE).getBoolean(KEY_SCREENSHOT_PROTECTION, false);
    }

    private boolean isKeepScreenOnActive() {
        return getSharedPreferences(META_PREFS, MODE_PRIVATE).getBoolean(KEY_KEEP_SCREEN_ON, false);
    }

    private int getCurrentVersionCode() {
        try {
            PackageInfo pi = getPackageManager().getPackageInfo(getPackageName(), 0);
            return pi.versionCode;
        } catch (Exception e) {
            return 8;
        }
    }

    private boolean isLegacyPackageInstalled() {
        if (LEGACY_PACKAGE.equals(getPackageName())) return false;
        try {
            getPackageManager().getPackageInfo(LEGACY_PACKAGE, 0);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    private void configureWebView(WebView wv) {
        WebSettings s = wv.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);

        wv.addJavascriptInterface(new AndroidJsBridge(), "MeshChatAndroid");

        wv.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (uri != null && "127.0.0.1".equals(uri.getHost())) {
                    return false;
                }
                if (uri != null && ("http".equals(uri.getScheme()) || "https".equals(uri.getScheme()))) {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                    return true;
                }
                return false;
            }
        });

        wv.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(
                    WebView view,
                    ValueCallback<Uri[]> filePathCallback,
                    FileChooserParams fileChooserParams
            ) {
                if (fileUploadCallback != null) {
                    fileUploadCallback.onReceiveValue(null);
                }
                fileUploadCallback = filePathCallback;
                try {
                    Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    intent.setType("*/*");
                    if (fileChooserParams != null
                            && fileChooserParams.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE) {
                        intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                    }
                    startActivityForResult(Intent.createChooser(intent, "Выберите файл"), REQ_FILE_CHOOSER);
                    return true;
                } catch (Exception e) {
                    fileUploadCallback = null;
                    return false;
                }
            }

            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> {
                    for (String res : request.getResources()) {
                        if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(res)) {
                            if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                                request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
                            } else {
                                pendingWebRtcPermission = request;
                                requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQ_RECORD_AUDIO);
                            }
                            return;
                        }
                    }
                    request.deny();
                });
            }
        });
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_FILE_CHOOSER && fileUploadCallback != null) {
            Uri[] results = null;
            if (resultCode == Activity.RESULT_OK && data != null) {
                ClipData clip = data.getClipData();
                if (clip != null && clip.getItemCount() > 0) {
                    results = new Uri[clip.getItemCount()];
                    for (int i = 0; i < clip.getItemCount(); i++) {
                        results[i] = clip.getItemAt(i).getUri();
                    }
                } else if (data.getData() != null) {
                    results = new Uri[]{data.getData()};
                }
            }
            fileUploadCallback.onReceiveValue(results);
            fileUploadCallback = null;
        } else if (requestCode == REQ_INSTALL_UNKNOWN_APPS && updater != null) {
            updater.triggerPackageInstallerIfPermitted();
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_RECORD_AUDIO && pendingWebRtcPermission != null) {
            if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                pendingWebRtcPermission.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
            } else {
                pendingWebRtcPermission.deny();
            }
            pendingWebRtcPermission = null;
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        isForeground = true;
        try {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.cancelAll();
        } catch (Exception ignored) {
        }
        if (webView != null) {
            webView.onResume();
            webView.evaluateJavascript("window.dispatchEvent(new Event('meshchat:resume'));", null);
        }
    }

    @Override
    protected void onPause() {
        isForeground = false;
        super.onPause();
    }

    @Override
    public void onBackPressed() {
        if (webView != null) {
            webView.evaluateJavascript(
                    "(window.__meshChatHandleBack && window.__meshChatHandleBack()) ? '1' : '0'",
                    value -> {
                        if ("\"1\"".equals(value) || "1".equals(value)) {
                            return;
                        }
                        if (webView != null && webView.canGoBack()) {
                            webView.goBack();
                        } else {
                            MainActivity.super.onBackPressed();
                        }
                    }
            );
            return;
        }
        super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
        if (localNode != null) localNode.stopAll();
        if (socksBridge != null) socksBridge.stop();
        super.onDestroy();
    }

    /** Нативный мост управления узлами, автообновлением, сохранением файлов, уведомлениями и AndroidKeyStore */
    public final class AndroidJsBridge {
        @JavascriptInterface
        public String getAppInfoJson() {
            try {
                PackageInfo pi = getPackageManager().getPackageInfo(getPackageName(), 0);
                JSONObject o = new JSONObject();
                o.put("packageName", getPackageName());
                o.put("versionName", pi.versionName);
                o.put("versionCode", pi.versionCode);
                o.put("localPort", localNode != null ? localNode.getBoundPort() : MeshLocalNode.LOCAL_PORT);
                o.put("bridgePort", socksBridge != null ? socksBridge.getBoundPort() : MeshSocksBridge.BRIDGE_PORT);
                o.put("legacyInstalled", isLegacyPackageInstalled());
                o.put("screenshotProtection", isScreenshotProtectionActive());
                o.put("keepScreenOn", isKeepScreenOnActive());
                return o.toString();
            } catch (Exception e) {
                return "{\"packageName\":\"io.meshchat.app\",\"legacyInstalled\":false,\"screenshotProtection\":false,\"keepScreenOn\":false}";
            }
        }

        @JavascriptInterface
        public boolean isScreenshotProtectionEnabled() {
            return isScreenshotProtectionActive();
        }

        @JavascriptInterface
        public boolean setScreenshotProtection(boolean enabled) {
            getSharedPreferences(META_PREFS, MODE_PRIVATE)
                    .edit()
                    .putBoolean(KEY_SCREENSHOT_PROTECTION, enabled)
                    .apply();
            runOnUiThread(() -> applyWindowSecureFlag(enabled));
            return enabled;
        }

        @JavascriptInterface
        public boolean setKeepScreenOn(boolean enabled) {
            getSharedPreferences(META_PREFS, MODE_PRIVATE)
                    .edit()
                    .putBoolean(KEY_KEEP_SCREEN_ON, enabled)
                    .apply();
            runOnUiThread(() -> applyKeepScreenOnFlag(enabled));
            return enabled;
        }

        @JavascriptInterface
        public void setSystemBarColor(String hexColor) {
            if (hexColor == null || hexColor.isEmpty()) return;
            runOnUiThread(() -> {
                try {
                    int color = Color.parseColor(hexColor);
                    Window w = getWindow();
                    if (w != null) {
                        w.setStatusBarColor(color);
                        w.setNavigationBarColor(color);
                    }
                    if (webView != null) {
                        webView.setBackgroundColor(color);
                    }
                } catch (Exception ignored) {
                }
            });
        }

        @JavascriptInterface
        public void vibrate(int durationMs) {
            int clamped = Math.max(5, Math.min(durationMs, 150));
            try {
                Vibrator vib = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
                if (vib != null && vib.hasVibrator()) {
                    vib.vibrate(VibrationEffect.createOneShot(clamped, VibrationEffect.DEFAULT_AMPLITUDE));
                }
            } catch (Exception ignored) {
            }
        }

        @JavascriptInterface
        public boolean saveBase64Document(String fileName, String mimeType, String base64Data) {
            if (base64Data == null || base64Data.isEmpty()) return false;
            try {
                byte[] bytes = Base64.decode(base64Data, Base64.DEFAULT);
                String safeName = (fileName != null && !fileName.trim().isEmpty())
                        ? fileName.replaceAll("[\\\\/:*?\"<>|]", "_")
                        : "meshchat-export.bin";
                String safeMime = (mimeType != null && !mimeType.trim().isEmpty())
                        ? mimeType
                        : "application/octet-stream";

                if (Build.VERSION.SDK_INT >= 29) {
                    ContentValues values = new ContentValues();
                    values.put(MediaStore.Downloads.DISPLAY_NAME, safeName);
                    values.put(MediaStore.Downloads.MIME_TYPE, safeMime);
                    values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
                    ContentResolver resolver = getContentResolver();
                    Uri uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                    if (uri != null) {
                        try (OutputStream os = resolver.openOutputStream(uri)) {
                            if (os != null) {
                                os.write(bytes);
                                os.flush();
                                return true;
                            }
                        }
                    }
                }

                File dlDir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                if (dlDir == null) dlDir = getFilesDir();
                File out = new File(dlDir, safeName);
                try (FileOutputStream fos = new FileOutputStream(out)) {
                    fos.write(bytes);
                    fos.flush();
                }
                return true;
            } catch (Exception e) {
                return false;
            }
        }

        @JavascriptInterface
        public void requestNotificationPermission() {
            if (Build.VERSION.SDK_INT >= 33) {
                runOnUiThread(() -> {
                    if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                        requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQ_POST_NOTIFICATIONS);
                    }
                });
            }
        }

        @JavascriptInterface
        public void showLocalNotification(String title, String body) {
            if (isForeground) return;
            try {
                if (Build.VERSION.SDK_INT >= 33
                        && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                    return;
                }
                NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
                if (nm == null) return;
                Intent openIntent = new Intent(MainActivity.this, MainActivity.class);
                openIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
                PendingIntent pi = PendingIntent.getActivity(
                        MainActivity.this,
                        0,
                        openIntent,
                        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
                );
                Notification notif = new Notification.Builder(MainActivity.this, NOTIF_CHANNEL_ID)
                        .setSmallIcon(android.R.drawable.stat_notify_chat)
                        .setContentTitle(title != null ? title : "MeshChat")
                        .setContentText(body != null ? body : "Новое зашифрованное сообщение")
                        .setContentIntent(pi)
                        .setAutoCancel(true)
                        .build();
                nm.notify(notifSeq.incrementAndGet(), notif);
            } catch (Exception ignored) {
            }
        }

        @JavascriptInterface
        public void uninstallLegacyPackage() {
            if (!isLegacyPackageInstalled()) return;
            runOnUiThread(() -> {
                try {
                    Intent del = new Intent(Intent.ACTION_DELETE, Uri.parse("package:" + LEGACY_PACKAGE));
                    del.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(del);
                } catch (Exception ignored) {
                }
            });
        }

        @JavascriptInterface
        public void writeNativeVault(String key, String value) {
            if (nativeVault != null) nativeVault.write(key, value);
        }

        @JavascriptInterface
        public String readNativeVault(String key) {
            return nativeVault != null ? nativeVault.read(key) : null;
        }

        @JavascriptInterface
        public void deleteNativeVault(String key) {
            if (nativeVault != null) nativeVault.delete(key);
        }

        @JavascriptInterface
        public void clearNativeVault() {
            if (nativeVault != null) nativeVault.clearAll();
        }

        @JavascriptInterface
        public void setUpstreamServer(String serverUrl) {
            if (localNode != null) {
                localNode.setUpstreamServer(serverUrl);
            }
        }

        @JavascriptInterface
        public String toggleLanMesh(boolean enable) {
            boolean running = localNode != null && localNode.setLanMeshEnabled(enable);
            return buildStatusJson(running);
        }

        @JavascriptInterface
        public String getLanStatusJson() {
            boolean running = localNode != null && localNode.isLanMeshRunning();
            return buildStatusJson(running);
        }

        @JavascriptInterface
        public void downloadAndInstallUpdate(String apkUrl, String expectedSha256) {
            if (updater == null) return;
            updater.downloadAndInstall(apkUrl, expectedSha256, (pct, statusText, errText) -> {
                runOnUiThread(() -> {
                    if (webView == null) return;
                    String js = "window.__onMeshChatUpdateProgress && window.__onMeshChatUpdateProgress("
                            + pct + ","
                            + JSONObject.quote(statusText != null ? statusText : "") + ","
                            + (errText != null ? JSONObject.quote(errText) : "null") + ");";
                    webView.evaluateJavascript(js, null);
                });
            });
        }

        private String buildStatusJson(boolean running) {
            try {
                JSONObject o = new JSONObject();
                o.put("running", running);
                o.put("url", running && localNode != null ? localNode.detectLanUrl() : "");
                return o.toString();
            } catch (Exception e) {
                return "{\"running\":false,\"url\":\"\"}";
            }
        }
    }
}
