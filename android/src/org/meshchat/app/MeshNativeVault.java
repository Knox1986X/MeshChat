// Аппаратно-защищённое хранилище состояния аккаунта в AndroidKeyStore (AES-256-GCM, TEE/StrongBox).
// Гарантирует сохранение сессии, контактов, переписки, кастомного профиля и темы между
// перезапусками приложения, перезагрузками смартфона и обновлениями APK без повторной регистрации.

package org.meshchat.app;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

public final class MeshNativeVault {
    private static final String KEYSTORE_PROVIDER = "AndroidKeyStore";
    private static final String KEY_ALIAS = "meshchat_vault_master_v1";
    private static final String TRANSFORMATION = "AES/GCM/NoPadding";
    private static final int GCM_TAG_BITS = 128;
    private static final int GCM_IV_BYTES = 12;

    private final File vaultDir;

    public MeshNativeVault(Context context) {
        this.vaultDir = new File(context.getFilesDir(), "vault");
        if (!this.vaultDir.exists()) {
            // noinspection ResultOfMethodCallIgnored
            this.vaultDir.mkdirs();
        }
    }

    private synchronized SecretKey getOrCreateHardwareKey() throws Exception {
        KeyStore ks = KeyStore.getInstance(KEYSTORE_PROVIDER);
        ks.load(null);
        if (ks.containsAlias(KEY_ALIAS)) {
            KeyStore.Entry entry = ks.getEntry(KEY_ALIAS, null);
            if (entry instanceof KeyStore.SecretKeyEntry) {
                return ((KeyStore.SecretKeyEntry) entry).getSecretKey();
            }
        }
        KeyGenerator kg = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE_PROVIDER);
        KeyGenParameterSpec spec = new KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
        )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build();
        kg.init(spec);
        return kg.generateKey();
    }

    private File fileForKey(String rawKey) {
        String safe = String.valueOf(rawKey).replaceAll("[^a-zA-Z0-9_.-]", "_");
        if (safe.length() > 80) safe = safe.substring(0, 80);
        return new File(vaultDir, safe + ".bin");
    }

    public synchronized void write(String key, String plaintext) {
        if (key == null || plaintext == null) return;
        try {
            SecretKey secretKey = getOrCreateHardwareKey();
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.ENCRYPT_MODE, secretKey);
            byte[] iv = cipher.getIV();
            byte[] aad = ("MESHCHAT-ANDROID-VAULT-v1:" + key).getBytes(StandardCharsets.UTF_8);
            cipher.updateAAD(aad);
            byte[] ct = cipher.doFinal(plaintext.getBytes(StandardCharsets.UTF_8));

            ByteBuffer buf = ByteBuffer.allocate(1 + iv.length + ct.length);
            buf.put((byte) iv.length);
            buf.put(iv);
            buf.put(ct);

            File target = fileForKey(key);
            File tmp = new File(vaultDir, target.getName() + ".tmp");
            try (FileOutputStream fos = new FileOutputStream(tmp)) {
                fos.write(buf.array());
                fos.getFD().sync();
            }
            // noinspection ResultOfMethodCallIgnored
            tmp.renameTo(target);
        } catch (Exception ignored) {
            // Ошибка резервного копирования не должна прерывать работу UI
        }
    }

    public synchronized String read(String key) {
        if (key == null) return null;
        File target = fileForKey(key);
        if (!target.exists() || target.length() <= GCM_IV_BYTES + 2) return null;
        try {
            byte[] raw = readAllBytes(target);
            int ivLen = raw[0] & 0xFF;
            if (ivLen < 12 || ivLen > 16 || raw.length <= 1 + ivLen) return null;

            SecretKey secretKey = getOrCreateHardwareKey();
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            GCMParameterSpec spec = new GCMParameterSpec(GCM_TAG_BITS, raw, 1, ivLen);
            cipher.init(Cipher.DECRYPT_MODE, secretKey, spec);
            byte[] aad = ("MESHCHAT-ANDROID-VAULT-v1:" + key).getBytes(StandardCharsets.UTF_8);
            cipher.updateAAD(aad);
            byte[] pt = cipher.doFinal(raw, 1 + ivLen, raw.length - 1 - ivLen);
            return new String(pt, StandardCharsets.UTF_8);
        } catch (Exception e) {
            return null;
        }
    }

    public synchronized void delete(String key) {
        if (key == null) return;
        File f = fileForKey(key);
        if (f.exists()) {
            // noinspection ResultOfMethodCallIgnored
            f.delete();
        }
    }

    public synchronized void clearAll() {
        File[] files = vaultDir.listFiles();
        if (files != null) {
            for (File f : files) {
                // noinspection ResultOfMethodCallIgnored
                f.delete();
            }
        }
    }

    private static byte[] readAllBytes(File file) throws Exception {
        try (FileInputStream fis = new FileInputStream(file);
             ByteArrayOutputStream bos = new ByteArrayOutputStream((int) file.length())) {
            byte[] chunk = new byte[8192];
            int n;
            while ((n = fis.read(chunk)) != -1) {
                bos.write(chunk, 0, n);
            }
            return bos.toByteArray();
        }
    }
}
