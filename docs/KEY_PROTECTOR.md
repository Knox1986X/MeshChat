# AndroidKeyProtector: текущий контракт и ограничения

Статус: Android-адаптер скомпилирован в GitHub Actions и подключён к явному
LAB roundtrip-тесту через системный BiometricPrompt. **На реальном устройстве пока
не проверен**, для пользовательских ключей/хранилища не используется. Это не
закрывает hardware release gates. Приватных ключей production-подписи здесь нет.

## Реализованная граница

`apps/android/app/src/main/java/org/meshchat/lab/security/AndroidKeyProtector.kt`
использует JCA `AndroidKeyStore` AES256/GCM/NoPadding для wrapping случайного32-byte
ключа хранилища. Никакой самописной криптографии, парольного KDF или ратчета.

- Alias соответствует `meshchat.lab.wrap.v1.<32 lowercase hex>` и передаётся только
  доверенным кодом установки. Новый alias — новая installation generation; alias
  не приходит из IPC. Не заменять существующий key при ошибке unlock.
- `create(STRONGBOX_REQUIRED)` не пробует TEE автоматически. Вызов
  `create(TEE_EXPLICITLY_ALLOWED)` допустим только после отдельного решения UI.
  `KeyInfo` проверяется повторно перед каждой операцией: software key запрещён,
  user authentication required и key size256 обязательны.
- API31+ сообщает StrongBox/TEE через `securityLevel`; API29/30 показывает только
  `LEGACY_HARDWARE_UNSPECIFIED` по `isInsideSecureHardware` — не рисовать зелёный
  значок StrongBox на основании одной сохранённой строки.
- Per-use strong biometric authentication. На API30+ —
  `setUserAuthenticationParameters(0, AUTH_BIOMETRIC_STRONG)`, API29 — legacy per-use
  biometric key. Изменение biometric enrollment invalidates key. **PIN/system
  credential fallback и устройства без подходящей биометрии пока не поддержаны**:
  не снимать auth required и не создавать software key ради совместимости.
- `beginWrap`/`beginUnwrap` возвращает одноразовую операцию. Её `cryptoObject`
  предназначен для `android.hardware.biometrics.BiometricPrompt.authenticate`.
  `BiometricCoordinator` вызывает системный prompt и проверяет identity Cipher
  из успешного callback. Keystore `doFinal` всё равно требует аппаратного auth;
  передать `authenticated=true` вместо него невозможно.
- Cancel/lock: UI обязан одновременно отменить CancellationSignal, закрыть pending
  operation и освободить CryptoObject. `close()` очищает свои buffers/ссылки, но
  не обещает стереть OS provider copies или отозвать уже отданную JVM ссылку.
- `finishConsumingKeyAfterAuthentication` принимает владение входным ByteArray32 и
  вызывает fill(0) даже при ошибке/повторном вызове. Это best effort JVM wipe,
  не доказательство очистки всех GC/JNI/codec копий. Не использовать Strings,
  Bundle, SavedState, clipboard или logcat для keys. Unwrap отдаёт ByteArray32;
  его владелец обязан как можно быстрее передать в core и очистить JVM копию.
- Worker serialized: generation/inspection/deletion для тестового alias идут на
  single-thread worker `HardwareLabController`; authenticated doFinal кратко идёт
  в main-thread callback. Операции защищены `@Synchronized`. `OperationGate` и
  Activity отменяют тест на pause/screen-off/timeout60s. Полноценного production
  installation/vault manager и остановки DB/core decrypt handles пока нет.

## Формат обёртки (локальный LAB, не EcoEnvelope wire protocol)

Ровно61 byte: `version=1` (1 byte) || fresh IV12 generated AndroidKeyStore ||
AES-GCM ciphertext32 || tag16. Version/length проверяются до Keystore access.
AAD = ASCII `MESHCHAT-LAB-VAULT-WRAP-V1\0` || ASCII alias || byte1 || vault_id16.
Alias имеет фиксированную форму/длину; контекст однозначен. Нельзя заменить vault ID,
версию, nonce или ciphertext и получить прежний ключ. Плохой tag даёт generic
`INTEGRITY_OR_PROVIDER_FAILURE`, а не fallback/recreate. No plaintext master key in
preferences, no deterministic nonce, no caller-chosen encrypt IV.

Сама обёртка не защищает от rollback старого ciphertext с тем же hardware key.
Нужны installation generation, rollback policy и запрет восстановления активного
ratchet; аппаратный wrapping не заменяет эти меры.

## Тесты

`KeyProtectorContractTest` содержит5 instrumented тестов одноразовых операций,
очистки caller buffer, wrong AAD/tag, malformed wrapper. Для этих тестов намеренно
используется **публичный synthetic software JCA key**, через внутренний constructor
operation. Тесты НЕ доказывают AndroidKeyStore/StrongBox/biometric enforcement.
Production key load/generation не имеет инъекции software provider.

Команда на подготовленном Android runner:
```
cd apps/android
gradle :app:connectedDebugAndroidTest
```

До релиза отдельно обязательно:
1. Hardware устройства с API29/30/31/35+, StrongBox, TEE-only и no-hardware; на
   no-hardware — отказ, на TEE-only default StrongBox отказ без hidden fallback.
2. Реальный BiometricPrompt: successful prompt → wrap/unwrap, cancel/negative/no
   enrollment → no key, doFinal без успешного prompt → AUTH_REQUIRED/failure.
3. Wrong biometric enrollment, reboot BFU/AFU, permanent invalidation; ни при одной
   ошибке не перегенерировать alias автоматически и не терять старую БД молча.
4. Lock/background/timeout while prompt or unwrap: cancellation+close, без поздней
   выдачи plaintext в UI и без оставшихся core decrypt handles.
5. Попытка сменить wrapping key между inspect и operation, race delete/recreate:
   serialized installation manager; fail-closed на mismatch/error.
6. Раскрытие класса защиты в UI и отсутствие секретов во всех dumps/logs/backup.

Permission USE_BIOMETRIC добавлен. Создание тестового ключа запускается только по
кнопке, не из Compose recomposition. TEE требует отдельного подтверждения. Каждый
LAB run имеет новый alias/vault ID; предсуществующий alias после ALIAS_EXISTS не
удаляется. Нормальная отмена планирует удаление созданного тестового alias, но
process kill/power loss может оставить orphan alias: эта граница видна в UI.
LAB по-прежнему без сети/поля личного ввода/production release variant.

`OperationGateTest` содержит6 настоящих JVM tests жизненного цикла, выполняемых
CI отдельно от5 instrumented format tests. Никакой JVM test не является проверкой
AndroidKeyStore, BiometricPrompt, screen-off broadcast или StrongBox. Отмена prompt
при pause на отдельных OEM может быть чрезмерно строгой — проверять, а не убирать
fail-closed policy ради успешной демонстрации.
