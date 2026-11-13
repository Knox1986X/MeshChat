// Главный экран Android-приложения MeshChat v1.3.
// Запускает локальный Orbot/I2P SOCKS5-мост (127.0.0.1:17700), встроенный узел (127.0.0.1:17701),
// аппаратное хранилище сессии в AndroidKeyStore (MeshNativeVault) и автообновление через GitHub Releases.

package org.meshchat.app;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
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

public final class MainActivity extends Activity {
    private static final int REQ_FILE_CHOOSER = 1001;
    private static final int REQ_RECORD_AUDIO = 1002;
    public static final int REQ_INSTALL_UNKNOWN_APPS = 1003;

    private WebView webView;
    private MeshSocksBridge socksBridge;
    private MeshLocalNode localNode;
    private MeshUpdater updater;
    private MeshNativeVault nativeVault;
    private ValueCallback<Uri[]> fileUploadCallback;
    private PermissionRequest pendingWebRtcPermission;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        Window window = getWindow();
        if (window != null) {
            window.addFlags(WindowManager.LayoutParams.FLAG_SECURE);
            window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
            window.setStatusBarColor(Color.parseColor("#0b0d14"));
            window.setNavigationBarColor(Color.parseColor("#0b0d14"));
        }

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

        root.addView(webView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
        ));
        setContentView(root);

        webView.loadUrl("http://127.0.0.1:" + MeshLocalNode.LOCAL_PORT + "/");
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
            if (resultCode == Activity.RESULT_OK && data != null && data.getData() != null) {
                results = new Uri[]{data.getData()};
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
        if (webView != null) {
            webView.onResume();
            webView.evaluateJavascript("window.dispatchEvent(new Event('meshchat:resume'));", null);
        }
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
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

    /** Нативный мост управления узлами, автообновлением и аппаратным хранилищем AndroidKeyStore */
    public final class AndroidJsBridge {
        @JavascriptInterface
        public String getAppInfoJson() {
            try {
                PackageInfo pi = getPackageManager().getPackageInfo(getPackageName(), 0);
                JSONObject o = new JSONObject();
                o.put("packageName", getPackageName());
                o.put("versionName", pi.versionName);
                o.put("versionCode", pi.versionCode);
                return o.toString();
            } catch (Exception e) {
                return "{\"packageName\":\"io.meshchat.app\"}";
            }
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
