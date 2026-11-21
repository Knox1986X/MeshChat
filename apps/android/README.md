# Android LAB — NOT a secure messenger

Нативный Kotlin/Compose эксперимент `org.meshchat.lab`. Нет INTERNET permission,
сообщений, пользовательского ввода/хранилища и exported IPC. Release variant выключен.
Это не production identity и не E2EE-мессенджер. APK подписывается только временным
Android debug key сборочного runner; никакие production signing keys в CI не нужны.

## Что можно проверить на устройстве

- Явно запустить создание временного аппаратного wrapping key.
- Пройти два системных BiometricPrompt: wrap и unwrap случайного тестового key32.
- Сравнение восстановленного ключа без отображения его в UI; plaintext ByteArray
  очищается best effort. В prefs/files/Bundle ключи и обёртки не сохраняются.
- StrongBox требуется по умолчанию. TEE — только через отдельный AlertDialog и
  на один тест. Software fallback запрещён; отсутствие enrolled strong biometric
  приводит к отказу, не обходу аутентификации.
- Уход из Activity (`onPause`), screen-off, timeout60s и кнопка отмены закрывают
  операцию/отменяют OS prompt; поздние callbacks отбрасываются. Нет фонового decrypt.
- По завершении/отмене удаляется только alias, успешно созданный данным тестом.
  Process kill/power loss может оставить orphan test alias; удаление/переустановка
  LAB-приложения очищает его. Это не гарантия crypto-shred всех OS copies.

## Сборка

Нужны JDK17, Android SDK platform35/build-tools для AGP8.9.2, Gradle8.11.1.
Gradle wrapper и полная dependency verification/locking ещё не подготовлены —
reproducible production release остаётся запрещён.

```
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
  **software JCA** keys. CI пока только компилирует APK этих тестов, не запускает
  их на телефоне. Запуск: `gradle :app:connectedDebugAndroidTest`.
- BiometricPrompt, StrongBox/TEE, BFU/AFU, rotation/background/OEM и capture/backup
  требуют реальных устройств. Unit tests и lint это не доказывают.
- `HardwareLabController` не полноценный vault lock manager. Главного encrypted
  container, установки ключей в Rust core и отзыва UI/DB handles пока нет.

Контракт: `../../docs/KEY_PROTECTOR.md`. Следующие шаги: real-device hardware tests,
production key lifecycle, SQLCipher/atomic outbox, reviewed crypto adapter и UniFFI.
Не вводите личные сообщения и не оценивайте безопасность переписки по LAB-тесту.
