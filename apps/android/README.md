# Android LAB — NOT a secure messenger

Нативный Kotlin/Compose эксперимент `org.meshchat.lab`. Нет INTERNET permission,
сообщений, пользовательского ввода/хранилища и exported IPC. Release variant выключен.
Это не production identity и не E2EE-мессенджер. APK подписывается только временным
Android debug key сборочного runner; никакие production signing keys в CI не нужны.

## Что можно проверить на устройстве

- Явно запустить создание временного аппаратного wrapping key.
- Пройти два системных BiometricPrompt: wrap и unwrap случайного тестового key32.
- Сравнение восстановленного ключа без отображения его в UI;
  затем реальный UniFFI/SQLCipher create/lock/reopen пустой временной БД; plaintext ByteArray
  очищается best effort. В prefs/files/Bundle ключи и обёртки не сохраняются.
- StrongBox требуется по умолчанию. TEE — только через отдельный AlertDialog и
  на один тест. Software fallback запрещён; отсутствие enrolled strong biometric
  приводит к отказу, не обходу аутентификации.
- Уход из Activity (`onPause`), screen-off, timeout60s и кнопка отмены закрывают
  операцию/отменяют OS prompt; поздние callbacks отбрасываются. Нет фонового decrypt.
- По завершении/отмене отзывается Rust runtime, затем удаляются временные БД и только alias, успешно созданный данным тестом.
  Process kill/power loss может оставить orphan test alias; удаление/переустановка
  LAB-приложения очищает его. Это не гарантия crypto-shred всех OS copies.

## Сборка

Нужны Linux x86_64, Rust/C build tools/Perl, JDK17, Android SDK platform35/build-tools для AGP8.9.2, Gradle8.11.1 и NDK27.2.12479018. `ANDROID_HOME` должен указывать SDK.
Gradle wrapper и полная dependency verification/locking ещё не подготовлены —
reproducible production release остаётся запрещён.

```
# Из корня репозитория, до Gradle (generated outputs не коммитятся):
python3 tools/build_android_native.py
cd apps/android
gradle :app:testDebugUnitTest :app:lintDebug :app:assembleDebug :app:assembleDebugAndroidTest
```

Debug APK: `app/build/outputs/apk/debug/app-debug.apk`, не включать в Git.
В GitHub Actions job `android-lab` выполняет эту настоящую сборку и пакует
`MeshChat-LAB.apk` вместе с `LAB_WARNING.txt`/SHA256 в artifact
`MeshChat-LAB-not-a-messenger` (retention7d). См. фактические CI evidence в
`../../docs/PROGRESS.md`. Локальная Arena-среда всё ещё без JDK/SDK/Rust; runner
GitHub позволяет выполнить проверку, которой здесь не было.

## Тесты и честные границы

- 6 JVM unit-тестов `OperationGateTest`: одноразовость, stale/cross-gate callbacks,
  cancel/replace/exception cleanup, close terminal, poison on cleanup failure.
- 5 instrumented `KeyProtectorContractTest`: operations/format на public synthetic
  **software JCA** keys. Добавлены3 `NativeVaultIntegrationTest` — настоящий
  Kotlin/JNA/UniFFI/SQLCipher на public synthetic key: create/lock/reopen, stale
  unlock, terminal shutdown. Новый CI требует выполнения на AOSP API30 x86_64
  эмуляторе; run44895321204 прошёл,8 instrumented tests выполнены. Запуск:
  `gradle :app:connectedDebugAndroidTest`.
- BiometricPrompt, StrongBox/TEE, BFU/AFU, rotation/background/OEM и capture/backup
  требуют реальных устройств. Unit tests и lint это не доказывают.
- `HardwareLabController` не полноценный vault lock manager. Главного encrypted
  persistent user container, восстановления после crash, policy для orphan keys
  и доказанного стирания всех key copies пока нет. Lifecycle Rust применяется
  только к отдельному временному LAB-run.

Контракт: `../../docs/KEY_PROTECTOR.md`. Следующие шаги: real-device hardware tests,
production key lifecycle, reviewed crypto adapter, доставка и persistent vault UI.
Не вводите личные сообщения и не оценивайте безопасность переписки по LAB-тесту.


## Диагностическая сборка для тестировщика

Кнопки «Просмотреть и экспортировать отчёт» и «Очистить журнал». Только allowlisted
коды этапов/ошибок, source revision/version/Android API;256 событий в RAM, без
автоматической отправки. Никакого полного logcat/bugreport. После завершения процесса
или пересоздания Activity события теряются. Сохранение `.txt` через системный picker
только по явному решению; облачный провайдер может загрузить выбранный файл.

[Инструкция и сценарии](../../docs/BETA_TESTING.md),
[свежий APK/точное evidence](../../docs/PROGRESS.md).
run44902408154 прошёл:9 JVM tests (3 теста ring buffer/clear/concurrency добавлены),
8 AOSP instrumented tests. Экран экспорта/picker и hardware flow вручную на физическом
устройстве ещё не проверены. Это диагностический LAB, не бета готовой переписки.


## Persistent enrollment prerequisite

`vault/EnrollmentRecord` и `EnrollmentRepository` сохраняют этапы RESERVED → WRAPPED
→ READY, policy, binding и wrapper без plaintext DB key. AtomicFile + file lock,
strict bounded parser, ошибки/остатки прерванной записи не разрешают automatic reset.
run44910392177:13 JVM tests +15 AOSP instrumented tests прошли. **К экрану hardware
vault ещё не подключено**; текущий UI всё ещё ephemeral LAB. Контракт и остаточные
блокеры: [VAULT_ENROLLMENT.md](../../docs/VAULT_ENROLLMENT.md).
